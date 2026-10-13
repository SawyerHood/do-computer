# Mobile app

`apps/mobile` is an Expo app for iOS and Android that does what the web app does, at a phone's
width: your Doods under their workspaces, each with a main chat and side chats, and its own
page (profile, memory, model and computers, skills, connectors, permissions, usage). There is
the creature's wardrobe with its treats and boxes, the library with a viewer and sharing by
link, automations, approval requests, dictation and push notifications. The message box is one line
until it is written in, and then has the Dood's model and how hard it thinks under the words.
A picture that was copied is pasted into it and attached. Settings cover teams
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
simulator; they have not yet been run on a physical phone or on Android from this repository. The Dood's creature is
drawn with `expo-gl`: on a device that cannot run it, a still picture is shown instead.

To build it for the iOS simulator on a Mac with Xcode and CocoaPods:

```sh
cd apps/mobile
npx expo prebuild -p ios           # writes ios/, which is not kept in the repository
npx expo run:ios                   # builds, installs and starts it with the dev server
```

To build it for a phone, with notifications, through Expo's build service (EAS):

```sh
cd apps/mobile
npx eas-cli@latest login
npx eas-cli@latest build --profile preview --platform ios
```

The build signs in to your Apple developer account, registers the phone, and makes the key
Apple delivers notifications with. Say yes to each. `eas.json` has the profiles: `preview`
installs on registered phones from a link, `production` is for TestFlight and the App Store.

A notification reaches a phone through the Expo project its build belongs to, named in
`app.config.ts`. That one is ours. For a build of your own, `eas init` makes a project and
prints its id; give it as `EAS_PROJECT_ID`, and change the bundle id, which Apple gives to one
team only. A server needs nothing set to notify a phone: it hands the message to Expo's push
service, which takes it without a key as long as the project's "enhanced security for push
notifications" is off.
