require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-grpc"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  # iOS 15.1 is the minimum of React Native 0.76+, the minimum supported version of this package.
  s.platforms    = { :ios => "15.1" }
  s.source       = { :git => "https://github.com/XDcobra/react-native-grpc.git", :tag => "#{s.version}" }


  s.source_files = "ios/**/*.{h,m,mm,swift}"


  s.dependency "React-Core"
  # gRPC 1.85.0 pulls abseil 1.20260526.0, whose CocoaPods spec compiles the Windows-only
  # time_zone_name_win.cc on Apple platforms (fatal error: 'windows.h' file not found).
  # Stay on 1.84.x until that is fixed upstream, then widen this range.
  s.dependency "gRPC", ">= 1.84.1", "< 1.85.0"

  # Pods directory corresponding to this app's Podfile, relative to the location of this podspec.
  pods_root = 'Pods'

  s.pod_target_xcconfig = {
    # This is needed by all pods that depend on gRPC-RxLibrary:
    'CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES' => 'YES',
  }
end