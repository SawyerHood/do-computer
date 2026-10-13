import { Stack, useRouter } from "expo-router"
import { useState } from "react"
import { Share, View } from "react-native"
import { copyText, Mono, useInstallCommand } from "@/computers/shared"
import { Field, Row, Screen, Section, Text } from "@/ui"

/** One command to run on the computer, with the ways of getting it there from a phone. */
function Command({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Section title={label}>
      <View style={{ paddingHorizontal: 16, paddingVertical: 12 }} accessibilityLabel={command}>
        <Mono>{command}</Mono>
      </View>
      <Row
        title={copied ? "Copied" : "Copy"}
        tone="tint"
        accessibilityLabel="Copy command"
        onPress={async () => {
          if (!(await copyText(command))) return
          setCopied(true)
          setTimeout(() => setCopied(false), 2500)
        }}
      />
      <Row
        title="Send to my Mac…"
        tone="tint"
        // The system's own sheet, which is where AirDrop is.
        onPress={() => void Share.share({ message: command }).catch(() => {})}
      />
    </Section>
  )
}

/**
 * Connecting a computer of one's own: the command that installs the daemon there, sent to it
 * from the phone, and the code the daemon then shows, which opens the pairing screen.
 */
export default function ConnectOwnComputer() {
  const router = useRouter()
  const install = useInstallCommand()
  const [code, setCode] = useState("")
  const entered = code.trim()
  const go = () => {
    if (entered !== "") router.push(`/pair?code=${encodeURIComponent(entered)}`)
  }
  return (
    <Screen>
      <Stack.Screen options={{ title: "Connect a computer of your own" }} />
      <Command
        label="Run this on the computer (macOS or Linux, with Node.js 20 or newer):"
        command={install}
      />
      <Command
        label="Or let Doods read files there without being able to run commands or change anything:"
        command={`${install} -s -- --read-only`}
      />
      <Text variant="footnote" tone="ink2" style={{ marginHorizontal: 32, marginBottom: 22 }}>
        It prints a link. Open it here to say whose the computer is and which Doods get access.
        Stopping the daemon, or removing the computer on this page, ends that access at once. The
        daemon keeps itself up to date from this server; add --no-auto-update to the command to
        stop it doing so.
      </Text>
      <Section
        title="Enter the code it shows"
        footer="The code is the end of the link the daemon prints. Codes last ten minutes."
      >
        <Field
          placeholder="Code"
          accessibilityLabel="Enter the code it shows"
          autoCapitalize="characters"
          autoCorrect={false}
          value={code}
          onChangeText={setCode}
          returnKeyType="go"
          onSubmitEditing={go}
        />
        <Row title="Continue" tone="tint" disabled={entered === ""} onPress={go} />
      </Section>
    </Screen>
  )
}
