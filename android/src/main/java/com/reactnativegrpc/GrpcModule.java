package com.reactnativegrpc;

import android.util.Base64;
import android.util.Log;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.annotation.UiThread;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.X509TrustManager;

import io.grpc.CallOptions;
import io.grpc.ClientCall;
import io.grpc.ConnectivityState;
import io.grpc.Grpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Metadata;
import io.grpc.MethodDescriptor;
import io.grpc.Status;
import io.grpc.TlsChannelCredentials;

public class GrpcModule extends ReactContextBaseJavaModule {
  static final String DEFAULT_CHANNEL_ID = "default";

  private final ReactApplicationContext context;
  private final HashMap<Integer, ClientCall> callsMap = new HashMap<>();
  private final HashMap<String, ChannelState> channels = new HashMap<>();

  private boolean isUiLogEnabled = false;

  private static final class ChannelState {
    String host;
    boolean isInsecure = false;
    boolean withCompression = false;
    String compressorName = "";
    Integer responseSizeLimit = null;
    boolean keepAliveEnabled = false;
    Integer keepAliveTime;
    Integer keepAliveTimeout;
    /** Per-call deadline in seconds (0 = no deadline). Default 120s. */
    long callDeadlineSeconds = 120;

    /** Custom PEM trust roots; null = platform/gRPC defaults. */
    String rootCertsPem = null;
    /** PEM client certificate chain for mTLS. */
    String certificateChainPem = null;
    /** PEM client private key for mTLS. */
    String privateKeyPem = null;
    /** TLS hostname / SNI override (e.g. dial by IP). */
    String hostNameOverride = null;
    /** SHA-256 SPKI pins (base64, without sha256/ prefix). */
    List<String> spkiSha256Pins = null;

    ManagedChannel managedChannel = null;
  }

  public GrpcModule(ReactApplicationContext context) {
    this.context = context;
    channels.put(DEFAULT_CHANNEL_ID, new ChannelState());
  }

  @NonNull
  @Override
  public String getName() {
    return "Grpc";
  }

  private ChannelState defaultChannel() {
    ChannelState state = channels.get(DEFAULT_CHANNEL_ID);
    if (state == null) {
      state = new ChannelState();
      channels.put(DEFAULT_CHANNEL_ID, state);
    }
    return state;
  }

  private ChannelState requireChannel(String channelId) throws Exception {
    String id = channelId == null || channelId.isEmpty() ? DEFAULT_CHANNEL_ID : channelId;
    ChannelState state = channels.get(id);
    if (state == null) {
      throw new Exception("Unknown channel: " + id);
    }
    return state;
  }

  @ReactMethod()
  public void getHost(final Promise promise) {
    promise.resolve(defaultChannel().host);
  }

  @ReactMethod()
  public void getIsInsecure(final Promise promise) {
    promise.resolve(defaultChannel().isInsecure);
  }

  @ReactMethod
  public void setHost(String host) {
    defaultChannel().host = host;
  }

  @ReactMethod
  public void setInsecure(boolean insecure) {
    defaultChannel().isInsecure = insecure;
  }

  /**
   * Replace TLS configuration (custom CA / mTLS / hostname override).
   * Omitted or null fields clear the previous value. Apply before initGrpcChannel().
   */
  @ReactMethod
  public void setTlsOptions(ReadableMap options) {
    ChannelState state = defaultChannel();
    state.rootCertsPem = readOptionalString(options, "rootCertsPem");
    state.certificateChainPem = readOptionalString(options, "certificateChainPem");
    state.privateKeyPem = readOptionalString(options, "privateKeyPem");
    state.hostNameOverride = readOptionalString(options, "hostNameOverride");
    state.spkiSha256Pins = SpkiPinTrustManager.normalizePins(
      readOptionalStringList(options, "spkiSha256Pins")
    );

    boolean hasCert = state.certificateChainPem != null && !state.certificateChainPem.isEmpty();
    boolean hasKey = state.privateKeyPem != null && !state.privateKeyPem.isEmpty();
    if (hasCert != hasKey) {
      throw new IllegalArgumentException(
        "mTLS requires both certificateChainPem and privateKeyPem"
      );
    }
  }

  private static String readOptionalString(ReadableMap options, String key) {
    if (options == null || !options.hasKey(key) || options.isNull(key)) {
      return null;
    }
    String value = options.getString(key);
    if (value == null || value.isEmpty()) {
      return null;
    }
    return value;
  }

  private static List<String> readOptionalStringList(ReadableMap options, String key) {
    if (options == null || !options.hasKey(key) || options.isNull(key)) {
      return null;
    }
    ReadableArray array = options.getArray(key);
    if (array == null || array.size() == 0) {
      return null;
    }
    List<String> values = new ArrayList<>();
    for (int i = 0; i < array.size(); i++) {
      String value = array.getString(i);
      if (value != null && !value.isEmpty()) {
        values.add(value);
      }
    }
    return values.isEmpty() ? null : values;
  }

  @ReactMethod
  public void setCompression(Boolean enable, String compressorName) {
    ChannelState state = defaultChannel();
    state.withCompression = enable;
    state.compressorName = compressorName;
  }

  @ReactMethod
  public void setResponseSizeLimit(int limit) {
    defaultChannel().responseSizeLimit = limit;
  }

  @ReactMethod
  public void setKeepAlive(boolean enabled, int time, int timeout) {
    ChannelState state = defaultChannel();
    state.keepAliveEnabled = enabled;
    state.keepAliveTime = time;
    state.keepAliveTimeout = timeout;
  }

  @ReactMethod
  public void setCallDeadlineSeconds(double seconds) {
    defaultChannel().callDeadlineSeconds = Math.max(0, (long) seconds);
  }

  /**
   * Create (or replace) a named channel from immutable config and open its ManagedChannel.
   * Does not affect the default channel used by setHost / initGrpcChannel.
   */
  @ReactMethod
  public void createChannel(String channelId, ReadableMap config) {
    if (channelId == null || channelId.isEmpty()) {
      throw new IllegalArgumentException("channelId is required");
    }
    if (DEFAULT_CHANNEL_ID.equals(channelId)) {
      throw new IllegalArgumentException("channelId \"default\" is reserved for GrpcClient");
    }
    if (config == null || !config.hasKey("host") || config.isNull("host")) {
      throw new IllegalArgumentException("createChannel requires host");
    }

    ChannelState existing = channels.get(channelId);
    if (existing != null && existing.managedChannel != null) {
      existing.managedChannel.shutdown();
    }

    ChannelState state = new ChannelState();
    state.host = config.getString("host");
    state.isInsecure = config.hasKey("insecure") && !config.isNull("insecure") && config.getBoolean("insecure");
    state.callDeadlineSeconds = config.hasKey("callDeadlineSeconds") && !config.isNull("callDeadlineSeconds")
      ? Math.max(0, (long) config.getDouble("callDeadlineSeconds"))
      : 120;
    if (config.hasKey("responseSizeLimit") && !config.isNull("responseSizeLimit")) {
      state.responseSizeLimit = config.getInt("responseSizeLimit");
    }
    state.withCompression = config.hasKey("compressionEnable")
      && !config.isNull("compressionEnable")
      && config.getBoolean("compressionEnable");
    state.compressorName = config.hasKey("compressorName") && !config.isNull("compressorName")
      ? config.getString("compressorName")
      : "";
    state.keepAliveEnabled = config.hasKey("keepAliveEnable")
      && !config.isNull("keepAliveEnable")
      && config.getBoolean("keepAliveEnable");
    if (config.hasKey("keepAliveTime") && !config.isNull("keepAliveTime")) {
      state.keepAliveTime = config.getInt("keepAliveTime");
    }
    if (config.hasKey("keepAliveTimeOut") && !config.isNull("keepAliveTimeOut")) {
      state.keepAliveTimeout = config.getInt("keepAliveTimeOut");
    }

    if (config.hasKey("tls") && !config.isNull("tls")) {
      ReadableMap tls = config.getMap("tls");
      state.rootCertsPem = readOptionalString(tls, "rootCertsPem");
      state.certificateChainPem = readOptionalString(tls, "certificateChainPem");
      state.privateKeyPem = readOptionalString(tls, "privateKeyPem");
      state.hostNameOverride = readOptionalString(tls, "hostNameOverride");
      state.spkiSha256Pins = SpkiPinTrustManager.normalizePins(
        readOptionalStringList(tls, "spkiSha256Pins")
      );
      boolean hasCert = state.certificateChainPem != null && !state.certificateChainPem.isEmpty();
      boolean hasKey = state.privateKeyPem != null && !state.privateKeyPem.isEmpty();
      if (hasCert != hasKey) {
        throw new IllegalArgumentException(
          "mTLS requires both certificateChainPem and privateKeyPem"
        );
      }
    }

    state.managedChannel = buildManagedChannel(state);
    channels.put(channelId, state);
  }

  @ReactMethod
  public void closeChannel(String channelId) {
    if (channelId == null || channelId.isEmpty() || DEFAULT_CHANNEL_ID.equals(channelId)) {
      return;
    }
    ChannelState state = channels.remove(channelId);
    if (state != null && state.managedChannel != null) {
      state.managedChannel.shutdown();
      state.managedChannel = null;
    }
  }

  @ReactMethod
  public void unaryCall(
    int id,
    String path,
    ReadableMap obj,
    ReadableMap headers,
    String channelId,
    final Promise promise
  ) {
    ClientCall call;

    try {
      ChannelState state = requireChannel(channelId);
      call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.UNARY, headers, resolveDeadline(obj, state), state);
    } catch (Exception e) {
      promise.reject(e);

      return;
    }

    byte[] data = Base64.decode(obj.getString("data"), Base64.NO_WRAP);

    call.sendMessage(data);
    call.request(1);
    call.halfClose();

    callsMap.put(id, call);

    promise.resolve(null);
  }

  @ReactMethod
  public void serverStreamingCall(
    int id,
    String path,
    ReadableMap obj,
    ReadableMap headers,
    String channelId,
    final Promise promise
  ) {
    ClientCall call;

    try {
      ChannelState state = requireChannel(channelId);
      call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.SERVER_STREAMING, headers, resolveDeadline(obj, state), state);
    } catch (Exception e) {
      promise.reject(e);

      return;
    }

    byte[] data = Base64.decode(obj.getString("data"), Base64.NO_WRAP);

    call.sendMessage(data);
    call.request(1);
    call.halfClose();

    callsMap.put(id, call);

    promise.resolve(null);
  }

  @ReactMethod
  public void clientStreamingCall(
    int id,
    String path,
    ReadableMap obj,
    ReadableMap headers,
    String channelId,
    final Promise promise
  ) {
    ClientCall call = callsMap.get(id);

    if (call == null) {
      try {
        ChannelState state = requireChannel(channelId);
        call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.CLIENT_STREAMING, headers, resolveDeadline(obj, state), state);
      } catch (Exception e) {
        promise.reject(e);

        return;
      }

      callsMap.put(id, call);
    }

    byte[] data = Base64.decode(obj.getString("data"), Base64.NO_WRAP);

    call.sendMessage(data);
    call.request(1);

    promise.resolve(null);
  }

  @ReactMethod
  public void bidiStreamingCall(
    int id,
    String path,
    ReadableMap obj,
    ReadableMap headers,
    String channelId,
    final Promise promise
  ) {
    ClientCall call = callsMap.get(id);

    if (call == null) {
      try {
        ChannelState state = requireChannel(channelId);
        call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.BIDI_STREAMING, headers, resolveDeadline(obj, state), state);
      } catch (Exception e) {
        promise.reject(e);

        return;
      }

      callsMap.put(id, call);
    }

    byte[] data = Base64.decode(obj.getString("data"), Base64.NO_WRAP);

    call.sendMessage(data);
    call.request(1);

    promise.resolve(null);
  }

  @ReactMethod
  public void finishClientStreaming(int id, final Promise promise) {
    if (callsMap.containsKey(id)) {
      ClientCall call = callsMap.get(id);

      call.halfClose();

      promise.resolve(true);
    } else {
      promise.resolve(false);
    }
  }

  @ReactMethod
  public void cancelGrpcCall(int id, final Promise promise) {
    if (callsMap.containsKey(id)) {
      ClientCall call = callsMap.get(id);
      call.cancel("Cancelled", new Exception("Cancelled by app"));

      promise.resolve(true);
    } else {
      promise.resolve(false);
    }
  }

  /** Resolve per-call deadline: obj.deadlineSeconds if set, else channel default. */
  private long resolveDeadline(ReadableMap obj, ChannelState state) {
    if (obj != null && obj.hasKey("deadlineSeconds") && !obj.isNull("deadlineSeconds")) {
      return Math.max(0, (long) obj.getDouble("deadlineSeconds"));
    }
    return state.callDeadlineSeconds;
  }

  private ClientCall startGrpcCall(
      int id,
      String path,
      MethodDescriptor.MethodType methodType,
      ReadableMap headers,
      long deadlineSeconds,
      ChannelState state
  ) throws Exception {
    if (state.managedChannel == null) {
      throw new Exception("Channel not created");
    }

    path = normalizePath(path);

    final Metadata headersMetadata = new Metadata();

    for (Map.Entry<String, Object> headerEntry : headers.toHashMap().entrySet()) {
      headersMetadata.put(Metadata.Key.of(headerEntry.getKey(), Metadata.ASCII_STRING_MARSHALLER), headerEntry.getValue().toString());
    }

    MethodDescriptor.Marshaller<byte[]> marshaller = new GrpcMarshaller();

    MethodDescriptor descriptor = MethodDescriptor.<byte[], byte[]>newBuilder()
      .setFullMethodName(path)
      .setType(methodType)
      .setRequestMarshaller(marshaller)
      .setResponseMarshaller(marshaller)
      .build();

    CallOptions callOptions = CallOptions.DEFAULT;

    if (!state.compressorName.isEmpty()) {
      callOptions = callOptions.withCompression(state.compressorName);
    }
    if (deadlineSeconds > 0) {
      callOptions = callOptions.withDeadlineAfter(deadlineSeconds, TimeUnit.SECONDS);
    }

    ClientCall call = state.managedChannel.newCall(descriptor, callOptions);

    call.start(new ClientCall.Listener() {
      @Override
      public void onHeaders(Metadata headers) {
        super.onHeaders(headers);

        WritableMap event = Arguments.createMap();
        WritableMap payload = Arguments.createMap();

        for (String key : headers.keys()) {
          if (key.endsWith(Metadata.BINARY_HEADER_SUFFIX)) {
            byte[] data = headers.get(Metadata.Key.of(key, Metadata.BINARY_BYTE_MARSHALLER));

            payload.putString(key, new String(Base64.encode(data, Base64.NO_WRAP)));
          } else if (!key.startsWith(":")) {
            String data = headers.get(Metadata.Key.of(key, Metadata.ASCII_STRING_MARSHALLER));

            payload.putString(key, data);
          }
        }

        event.putInt("id", id);
        event.putString("type", "headers");
        event.putMap("payload", payload);

        emitEvent("grpc-call", event);
      }

      @Override
      public void onMessage(Object messageObj) {
        super.onMessage(messageObj);

        byte[] data = (byte[]) messageObj;

        WritableMap event = Arguments.createMap();

        event.putInt("id", id);
        event.putString("type", "response");
        event.putString("payload", Base64.encodeToString(data, Base64.NO_WRAP));

        emitEvent("grpc-call", event);

        if (methodType == MethodDescriptor.MethodType.SERVER_STREAMING
            || methodType == MethodDescriptor.MethodType.BIDI_STREAMING) {
          call.request(1);
        }
      }

      @Override
      public void onClose(Status status, Metadata trailers) {
        super.onClose(status, trailers);

        callsMap.remove(id);

        WritableMap event = Arguments.createMap();
        event.putInt("id", id);

        WritableMap trailersMap = Arguments.createMap();

        for (String key : trailers.keys()) {
          if (key.endsWith(Metadata.BINARY_HEADER_SUFFIX)) {
            byte[] data = trailers.get(Metadata.Key.of(key, Metadata.BINARY_BYTE_MARSHALLER));

            trailersMap.putString(key, new String(Base64.encode(data, Base64.NO_WRAP)));
          } else if (!key.startsWith(":")) {
            String data = trailers.get(Metadata.Key.of(key, Metadata.ASCII_STRING_MARSHALLER));

            trailersMap.putString(key, data);
          }
        }

        if (!status.isOk()) {
          event.putString("type", "error");
          event.putString("error", status.asException(trailers).getLocalizedMessage());
          event.putInt("code", status.getCode().value());
          event.putMap("trailers", trailersMap);
        } else {
          event.putString("type", "trailers");
          event.putMap("payload", trailersMap);
        }

        emitEvent("grpc-call", event);
      }
    }, headersMetadata);

    if (state.withCompression) {
      call.setMessageCompression(true);
    }

    return call;
  }

  @ReactMethod
  public void addListener(String eventName) {
  }

  @ReactMethod
  public void removeListeners(Integer count) {
  }

  private void emitEvent(String eventName, Object params) {
    context
      .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
      .emit(eventName, params);
  }

  private static String normalizePath(String path) {
    if (path.startsWith("/")) {
      path = path.substring(1);
    }
    return path;
  }

  @ReactMethod
  public void initGrpcChannel() {
    ChannelState state = defaultChannel();
    if (state.managedChannel != null) {
      state.managedChannel.shutdown();
    }
    state.managedChannel = buildManagedChannel(state);
  }

  private ManagedChannel buildManagedChannel(ChannelState state) {
    ManagedChannelBuilder<?> channelBuilder;

    if (state.isInsecure) {
      channelBuilder = ManagedChannelBuilder.forTarget(state.host).usePlaintext();
    } else {
      boolean hasRoots = state.rootCertsPem != null && !state.rootCertsPem.isEmpty();
      boolean hasCert = state.certificateChainPem != null && !state.certificateChainPem.isEmpty();
      boolean hasKey = state.privateKeyPem != null && !state.privateKeyPem.isEmpty();
      boolean hasPins = state.spkiSha256Pins != null && !state.spkiSha256Pins.isEmpty();

      if (hasCert != hasKey) {
        throw new IllegalArgumentException(
          "mTLS requires both certificateChainPem and privateKeyPem"
        );
      }

      if (hasRoots || hasCert || hasPins) {
        try {
          TlsChannelCredentials.Builder tls = TlsChannelCredentials.newBuilder();
          if (hasRoots || hasPins) {
            X509TrustManager base = hasRoots
              ? TrustManagers.fromPemRoots(state.rootCertsPem)
              : TrustManagers.systemTrustManager();
            if (hasPins) {
              tls.trustManager(new SpkiPinTrustManager(base, state.spkiSha256Pins));
            } else {
              tls.trustManager(base);
            }
          }
          if (hasCert) {
            tls.keyManager(
              new ByteArrayInputStream(state.certificateChainPem.getBytes(StandardCharsets.UTF_8)),
              new ByteArrayInputStream(state.privateKeyPem.getBytes(StandardCharsets.UTF_8))
            );
          }
          channelBuilder = Grpc.newChannelBuilder(state.host, tls.build());
        } catch (IOException e) {
          throw new RuntimeException("Failed to configure TLS credentials", e);
        } catch (RuntimeException e) {
          throw e;
        } catch (Exception e) {
          throw new RuntimeException("Failed to configure TLS credentials", e);
        }
      } else {
        channelBuilder = ManagedChannelBuilder.forTarget(state.host);
      }

      if (state.hostNameOverride != null && !state.hostNameOverride.isEmpty()) {
        channelBuilder = channelBuilder.overrideAuthority(state.hostNameOverride);
      }
    }

    if (state.responseSizeLimit != null) {
      channelBuilder = channelBuilder.maxInboundMessageSize(state.responseSizeLimit);
    }

    if (state.keepAliveEnabled) {
      channelBuilder = channelBuilder
        .keepAliveWithoutCalls(true)
        .keepAliveTime(state.keepAliveTime, TimeUnit.SECONDS)
        .keepAliveTimeout(state.keepAliveTimeout, TimeUnit.SECONDS);
    }

    return channelBuilder.build();
  }

  @ReactMethod
  public void resetConnection(final String message){
    ChannelState state = defaultChannel();
    if(null == state.managedChannel) return;

    state.managedChannel.resetConnectBackoff();

    this.initGrpcChannel();

    showToast("resetConnection "+message);
  }

  @ReactMethod
  public void onConnectionStateChange(){
    ChannelState state = defaultChannel();
    ManagedChannel managedChannel = state.managedChannel;
    if(null == managedChannel) return;

    final ConnectivityState connectivityState = managedChannel.getState(true);
    if(ConnectivityState.CONNECTING == connectivityState){
      showToast("onConnectionState CONNECTING");
    } else if(ConnectivityState.IDLE == connectivityState){
      showToast("onConnectionState IDLE");
    } else if(ConnectivityState.READY == connectivityState){
      showToast("onConnectionState READY");
    } else if(ConnectivityState.TRANSIENT_FAILURE == connectivityState){
      showToast("onConnectionState TRANSIENT_FAILURE");
    } else if(ConnectivityState.SHUTDOWN == connectivityState){
      showToast("onConnectionState SHUTDOWN");
    } else {
      showToast("onConnectionState UNKNOWN");
    }
    if(ConnectivityState.TRANSIENT_FAILURE == connectivityState && managedChannel.isTerminated() || managedChannel.isShutdown()){
      resetConnection("onConnectionStateChange");
    }
  }

  @ReactMethod
  public void enterIdle(){
    ChannelState state = defaultChannel();
    if(null == state.managedChannel) return;

    state.managedChannel.enterIdle();

    showToast("enterIdle");
  }

  @ReactMethod
  public void setUiLogEnabled(boolean isUiLogEnabled){
    this.isUiLogEnabled = isUiLogEnabled;
  }

  @UiThread
  private void showToast(final String message){
    if(!isUiLogEnabled || null == context) return;

    Toast.makeText(context,message,Toast.LENGTH_SHORT).show();
    Log.d("GRPC_MODULE",message);
  }
}
