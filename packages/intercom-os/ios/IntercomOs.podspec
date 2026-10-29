# Expo の autolinking が読む。Core(React Native に依らない本体)と Binding(Expo のモジュール)を1つの pod にする
Pod::Spec.new do |s|
  s.name           = 'IntercomOs'
  s.version        = '0.1.0'
  s.summary        = 'OS の Push to Talk の仕組みを包むモジュール(voice-intercom)'
  s.homepage       = 'https://github.com/voice-intercom'
  s.license        = { type: 'Proprietary' }
  s.author         = 'voice-intercom'
  s.source         = { git: '' }
  s.platforms      = { ios: '16.0' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PushToTalk', 'AVFAudio'

  s.source_files = 'Core/**/*.swift', 'Binding/**/*.swift'
end
