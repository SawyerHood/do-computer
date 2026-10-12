# Mobile app

`apps/mobile` is an Expo app for iOS and Android: chat with streaming replies, dictation, the
library, automations, skills, approval requests and push notifications. It talks to your own
deployment; on first launch it asks for the server's address.

```sh
pnpm mobile              # Expo dev server; open in a development build
```

Push notifications and the microphone need a development build, not Expo Go. The app's screens
are tested through its web build; they have not yet been run on a device from this repository.
That includes the agent's creature, which is drawn with `expo-gl`: on a device that cannot run
it, a still picture is shown instead. There it wears what it was dressed in on the web; its treats, boxes
and wardrobe are not in the mobile app yet.
