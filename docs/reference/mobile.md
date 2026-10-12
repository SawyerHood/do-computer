# Mobile app

`apps/mobile` is an Expo app for iOS and Android that does what the web app does, at a phone's
width: your agents under their workspaces, each with a main chat and side chats, and its own
page (profile, memory, model and computers, skills, connectors, permissions, usage). There is
the creature's wardrobe with its treats and boxes, the library with a viewer and sharing by
link, automations, approval requests, dictation and push notifications. Settings cover teams
and their people, computers, and signing in to model providers. You sign in with a password,
GitHub or Google, and a new account goes through the first run. It talks to do.computer unless
you name your own deployment at the foot of the sign-in page.

```sh
pnpm mobile              # Expo dev server; open in a development build
```

It is still built from source. It is made for iOS 26: Liquid Glass, and the system's own bars,
menus and sheets. Elsewhere those are plain stand-ins. Push notifications, the microphone and
coming back from GitHub or Google need a development build, not Expo Go. The screens are
tested through the web build (`apps/web/e2e/mobile.spec.ts`) and have been run in an iOS
simulator; they have not yet been run on a physical phone or on Android from this repository. The agent's creature is
drawn with `expo-gl`: on a device that cannot run it, a still picture is shown instead.

To build it for the iOS simulator on a Mac with Xcode and CocoaPods:

```sh
cd apps/mobile
npx expo prebuild -p ios           # writes ios/, which is not kept in the repository
npx expo run:ios                   # builds, installs and starts it with the dev server
```
