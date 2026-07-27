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
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

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
  private final ReactApplicationContext context;
  private final HashMap<Integer, ClientCall> callsMap = new HashMap<>();

  private String host;
  private boolean isInsecure = false;
  private boolean withCompression = false;
  private String compressorName = "";
  private Integer responseSizeLimit = null;
  private boolean keepAliveEnabled = false;
  private Integer keepAliveTime;
  private Integer keepAliveTimeout;
  private boolean isUiLogEnabled = false;
  /** Per-call deadline in seconds (0 = no deadline). Default 120s. */
  private long callDeadlineSeconds = 120;

  /** Custom PEM trust roots; null = platform/gRPC defaults. */
  private String rootCertsPem = null;
  /** PEM client certificate chain for mTLS. */
  private String certificateChainPem = null;
  /** PEM client private key for mTLS. */
  private String privateKeyPem = null;
  /** TLS hostname / SNI override (e.g. dial by IP). */
  private String hostNameOverride = null;

  private ManagedChannel managedChannel = null;

  public GrpcModule(ReactApplicationContext context) {
    this.context = context;
  }

  @NonNull
  @Override
  public String getName() {
    return "Grpc";
  }

  @ReactMethod()
  public void getHost(final Promise promise) {
    promise.resolve(this.host);
  }

  @ReactMethod()
  public void getIsInsecure(final Promise promise) {
    promise.resolve(this.isInsecure);
  }

  @ReactMethod
  public void setHost(String host) {
    this.host = host;
  }

  @ReactMethod
  public void setInsecure(boolean insecure) {
    this.isInsecure = insecure;
  }

  /**
   * Replace TLS configuration (custom CA / mTLS / hostname override).
   * Omitted or null fields clear the previous value. Apply before initGrpcChannel().
   */
  @ReactMethod
  public void setTlsOptions(ReadableMap options) {
    this.rootCertsPem = readOptionalString(options, "rootCertsPem");
    this.certificateChainPem = readOptionalString(options, "certificateChainPem");
    this.privateKeyPem = readOptionalString(options, "privateKeyPem");
    this.hostNameOverride = readOptionalString(options, "hostNameOverride");

    boolean hasCert = this.certificateChainPem != null && !this.certificateChainPem.isEmpty();
    boolean hasKey = this.privateKeyPem != null && !this.privateKeyPem.isEmpty();
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

  @ReactMethod
  public void setCompression(Boolean enable, String compressorName) {
    this.withCompression = enable;
    this.compressorName = compressorName;
  }

  @ReactMethod
  public void setResponseSizeLimit(int limit) {
    this.responseSizeLimit = limit;
  }

  @ReactMethod
  public void setKeepAlive(boolean enabled, int time, int timeout) {
    this.keepAliveEnabled = enabled;
    this.keepAliveTime = time;
    this.keepAliveTimeout = timeout;
  }

  @ReactMethod
  public void setCallDeadlineSeconds(double seconds) {
    this.callDeadlineSeconds = Math.max(0, (long) seconds);
  }

  @ReactMethod
  public void unaryCall(int id, String path, ReadableMap obj, ReadableMap headers, final Promise promise) {
    ClientCall call;

    try {
      call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.UNARY, headers, resolveDeadline(obj));
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
  public void serverStreamingCall(int id, String path, ReadableMap obj, ReadableMap headers, final Promise promise) {
    ClientCall call;

    try {
      call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.SERVER_STREAMING, headers, resolveDeadline(obj));
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
  public void clientStreamingCall(int id, String path, ReadableMap obj, ReadableMap headers, final Promise promise) {
    ClientCall call = callsMap.get(id);

    if (call == null) {
      try {
        call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.CLIENT_STREAMING, headers, resolveDeadline(obj));
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
  public void bidiStreamingCall(int id, String path, ReadableMap obj, ReadableMap headers, final Promise promise) {
    ClientCall call = callsMap.get(id);

    if (call == null) {
      try {
        call = this.startGrpcCall(id, path, MethodDescriptor.MethodType.BIDI_STREAMING, headers, resolveDeadline(obj));
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

  /** Resolve per-call deadline: obj.deadlineSeconds if set, else global default. */
  private long resolveDeadline(ReadableMap obj) {
    if (obj != null && obj.hasKey("deadlineSeconds") && !obj.isNull("deadlineSeconds")) {
      return Math.max(0, (long) obj.getDouble("deadlineSeconds"));
    }
    return this.callDeadlineSeconds;
  }

  private ClientCall startGrpcCall(
      int id,
      String path,
      MethodDescriptor.MethodType methodType,
      ReadableMap headers,
      long deadlineSeconds
  ) throws Exception {
    if (this.managedChannel == null) {
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

    if (!this.compressorName.isEmpty()) {
      callOptions = callOptions.withCompression(this.compressorName);
    }
    if (deadlineSeconds > 0) {
      callOptions = callOptions.withDeadlineAfter(deadlineSeconds, TimeUnit.SECONDS);
    }

    ClientCall call = this.managedChannel.newCall(descriptor, callOptions);

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

    if (this.withCompression) {
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
    if (this.managedChannel != null) {
      this.managedChannel.shutdown();
    }
    this.managedChannel = createManagedChannel();
  }

  private ManagedChannel createManagedChannel() {
    ManagedChannelBuilder<?> channelBuilder;

    if (this.isInsecure) {
      channelBuilder = ManagedChannelBuilder.forTarget(this.host).usePlaintext();
    } else {
      boolean hasRoots = this.rootCertsPem != null && !this.rootCertsPem.isEmpty();
      boolean hasCert = this.certificateChainPem != null && !this.certificateChainPem.isEmpty();
      boolean hasKey = this.privateKeyPem != null && !this.privateKeyPem.isEmpty();

      if (hasCert != hasKey) {
        throw new IllegalArgumentException(
          "mTLS requires both certificateChainPem and privateKeyPem"
        );
      }

      if (hasRoots || hasCert) {
        try {
          TlsChannelCredentials.Builder tls = TlsChannelCredentials.newBuilder();
          if (hasRoots) {
            tls.trustManager(
              new ByteArrayInputStream(this.rootCertsPem.getBytes(StandardCharsets.UTF_8))
            );
          }
          if (hasCert) {
            tls.keyManager(
              new ByteArrayInputStream(this.certificateChainPem.getBytes(StandardCharsets.UTF_8)),
              new ByteArrayInputStream(this.privateKeyPem.getBytes(StandardCharsets.UTF_8))
            );
          }
          channelBuilder = Grpc.newChannelBuilder(this.host, tls.build());
        } catch (IOException e) {
          throw new RuntimeException("Failed to configure TLS credentials", e);
        }
      } else {
        channelBuilder = ManagedChannelBuilder.forTarget(this.host);
      }

      if (this.hostNameOverride != null && !this.hostNameOverride.isEmpty()) {
        channelBuilder = channelBuilder.overrideAuthority(this.hostNameOverride);
      }
    }

    if (this.responseSizeLimit != null) {
      channelBuilder = channelBuilder.maxInboundMessageSize(this.responseSizeLimit);
    }

    if (this.keepAliveEnabled) {
      channelBuilder = channelBuilder
        .keepAliveWithoutCalls(true)
        .keepAliveTime(keepAliveTime, TimeUnit.SECONDS)
        .keepAliveTimeout(keepAliveTimeout, TimeUnit.SECONDS);
    }

    managedChannel = channelBuilder.build();
    return managedChannel;
  }

  @ReactMethod
  public void resetConnection(final String message){
    if(null == managedChannel) return;

    this.managedChannel.resetConnectBackoff();

    this.initGrpcChannel();

    showToast("resetConnection "+message);
  }

  @ReactMethod
  public void onConnectionStateChange(){
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
      showToast("onConnectionState UNDEFINED");
    }
    if(ConnectivityState.TRANSIENT_FAILURE == connectivityState && managedChannel.isTerminated() || managedChannel.isShutdown()){
      resetConnection("onConnectionStateChange");
    }
  }

  @ReactMethod
  public void enterIdle(){
    if(null == managedChannel) return;

    managedChannel.enterIdle();

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
