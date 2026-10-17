# Snapshots from real backends

What each backend actually printed, for the tests of the code that reads it,
such as the role map, so they run against real spellings rather than ones
from a document.

| File | From | As |
| --- | --- | --- |
| `android-settings.json` | agent-device 0.21.27, the Settings app's first screen on an Android 16 emulator (Pixel 9 Pro XL image) | its `snapshot --json`, untouched |
| `android-display.json` | the same, Settings › Display & touch, with switches | the same |
| `android-search.json` | the same, Settings' search, with a focused field showing its hint | the same |
| `android-testapp-settings.json` | agent-device 0.21.28, the test app's settings on expo-interface 0.33.0, on the same emulator, with its bottom bar's tabs | its Node client's `capture.snapshot` nodes, untouched |
| `windows-documents.json` | the Windows host, the first screen of a react-native-windows 0.84 app | the harness's snapshot, with every name, testID, value, help and status replaced by a word, since the app is not ours to publish |
| `windows-settings.json` | the same app's settings screen: combo boxes, a list, a password field | the same |
| `web-expo-router.json` | the web driver, the home screen of the expo-interface example (Expo Router on react-native-web) | the harness's snapshot, untouched |
| `web-states.json` | the web driver, a page of one control in each state | the same |

The emulator is a clean image, so nothing in the Android files is anyone's.
There is no iOS file: it needs a Mac.
