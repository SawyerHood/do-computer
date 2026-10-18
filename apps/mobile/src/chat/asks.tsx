import {
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalsState,
  type ComputerRequest,
  type ConnectorSummary,
  CARD_CODE,
  isPersonalWorkspace,
  loginAnswer,
  MAX_LOGIN_SITES,
  MAX_SECRET_CHARS,
  type SecretRequest,
} from "@do-computer/protocol"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "expo-router"
import { type ReactNode, useState } from "react"
import { Pressable, ScrollView, TextInput, type TextInputProps, View } from "react-native"
import { keys, useAgentSummary, useWorkspaces } from "@/lib/queries"
import { type Accent, mono, radius, useTheme } from "@/lib/theme"
import { useSession } from "@/lib/use-session"
import { SITE_INPUT, useSiteAdder } from "@/passwords/fields"
import { loginsKey } from "@/passwords/keys"
import { Button, errorText, Glass, haptic, Icon, type IconName, Text } from "@/ui"

/** Do one thing for a card's button: busy while it runs, and what went wrong if it did. */
function useAnswer(after: () => unknown) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const run = async (what: () => Promise<unknown>, done?: () => void) => {
    setBusy(true)
    setError(undefined)
    try {
      await what()
      haptic.done()
      done?.()
    } catch (caught) {
      haptic.fail()
      setError(errorText(caught))
    } finally {
      setBusy(false)
      void after()
    }
  }
  return { busy, error, run }
}

const hostOf = (url: string) => /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url

/** One thing the agent is waiting to hear about: a glass card over the message box. */
function Card({
  icon,
  lead,
  children,
  error,
  note,
  buttons,
}: {
  icon: IconName
  /** The small line that says who asks and from where. */
  lead: ReactNode
  children?: ReactNode
  error?: string | undefined
  note?: string | undefined
  buttons?: ReactNode
}) {
  const theme = useTheme()
  return (
    <Glass style={{ borderRadius: radius.lg, borderCurve: "continuous", padding: 14, gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Icon name={icon} size={14} color={theme.ink2} />
        <Text variant="caption" tone="ink2" style={{ flex: 1 }}>
          {lead}
        </Text>
      </View>
      {children}
      {error === undefined ? null : (
        <Text variant="footnote" tone="red" accessibilityRole="alert">
          {error}
        </Text>
      )}
      {buttons === undefined ? null : (
        <View style={{ flexDirection: "row", gap: 8 }}>{buttons}</View>
      )}
      {note === undefined ? null : (
        <Text variant="caption" tone="ink2">
          {note}
        </Text>
      )}
    </Glass>
  )
}

const FROM: Record<ApprovalRequest["chatKind"], string> = {
  chat: "from the chat",
  schedule: "from the scheduled run",
  subagent: "from the sub-agent",
  agent: "from a conversation with another Dood,",
  slack: "from the Slack thread",
}

type Shared = {
  agentId: string
  agentName: string
  chatId: string
  accent: Accent
  team?: string | undefined
}

function ApprovalCard({
  request,
  agentId,
  agentName,
  chatId,
  accent,
  team,
}: Shared & { request: ApprovalRequest }) {
  const theme = useTheme()
  const router = useRouter()
  const { client } = useSession()
  const queryClient = useQueryClient()
  const answer = useAnswer(() =>
    queryClient.invalidateQueries({ queryKey: keys.approvals(agentId) }),
  )
  // What a yes has to come with, where the request wants something typed: a card's security
  // code, which is kept nowhere and forgotten here once it is sent.
  const [typed, setTyped] = useState("")
  const lacking = request.wants !== undefined && !CARD_CODE.test(typed.trim())
  const decide = (decision: ApprovalDecision) =>
    void answer
      .run(() =>
        client
          .agent(agentId)
          .answerApproval(
            request.id,
            decision,
            request.wants === undefined || decision === "deny" ? undefined : typed.trim(),
          ),
      )
      .finally(() => setTyped(""))
  return (
    <Card
      icon="shield"
      lead={
        request.chatId === chatId ? (
          `${agentName} asks first · from this chat`
        ) : (
          <>
            {agentName} asks first · {FROM[request.chatKind]}{" "}
            <Text
              variant="caption"
              color={accent.ink}
              accessibilityRole="link"
              onPress={() => router.push(`/a/${agentId}/c/${request.chatId}`)}
            >
              {request.chatTitle}
            </Text>
          </>
        )
      }
      error={answer.error}
      note={team === undefined ? undefined : `Anyone in ${team} can answer`}
      buttons={
        <>
          <Button
            title="Don’t allow"
            kind="grey"
            size="medium"
            style={{ flex: 1 }}
            disabled={answer.busy}
            onPress={() => decide("deny")}
          />
          {/* Asked about every time, "always" changes nothing. */}
          {request.onceOnly ? null : (
            <Button
              title="Always allow"
              kind="grey"
              size="medium"
              style={{ flex: 1 }}
              disabled={answer.busy}
              onPress={() => decide("always")}
            />
          )}
          <Button
            title="Allow once"
            size="medium"
            color={accent.a}
            onColor={accent.onA}
            style={{ flex: 1 }}
            disabled={answer.busy || lacking}
            onPress={() => decide("once")}
          />
        </>
      }
    >
      <Text variant="headline">{request.title}</Text>
      {request.detail === "" ? null : (
        <View
          style={{
            backgroundColor: theme.fill,
            borderRadius: radius.sm,
            padding: 10,
            maxHeight: 120,
            overflow: "hidden",
          }}
        >
          <Text
            style={{ fontFamily: mono, fontSize: 12, lineHeight: 17 }}
            tone="ink"
            numberOfLines={6}
          >
            {request.detail}
          </Text>
        </View>
      )}
      {request.wants === undefined ? null : (
        <TypedField
          label={request.wants.label}
          name={request.wants.label.toLowerCase()}
          secret
          value={typed}
          busy={answer.busy}
          accent={accent}
          onChangeText={setTyped}
          // A card's security code: three or four digits, on the keypad for them. It is not
          // named a security code to the system, as the web's box is not, so that nothing
          // offers to fill in or keep a code that is typed fresh for each payment.
          input={{ keyboardType: "number-pad", maxLength: 4 }}
        />
      )}
    </Card>
  )
}

function ComputerCard({
  request,
  agentName,
  accent,
}: {
  request: ComputerRequest
  agentName: string
  accent: Accent
}) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const workspaces = useWorkspaces().data?.workspaces
  const team = isPersonalWorkspace(request.computer.workspaceId)
    ? undefined
    : workspaces?.find((each) => each.id === request.computer.workspaceId)
  // Prefix of the list of computers too, which gains an agent when the answer is yes.
  const answer = useAnswer(() => queryClient.invalidateQueries({ queryKey: keys.computers }))
  const decide = (approve: boolean) =>
    void answer.run(() => client.answerComputerRequest(request.id, approve))
  return (
    <Card
      icon="desktop"
      lead={`${agentName} asks to use a computer`}
      error={answer.error}
      note={
        !request.canAnswer
          ? `Waiting for ${team?.name ?? request.computer.pairedBy.name} to answer.`
          : team !== undefined
            ? `Anyone in ${team.name} can answer`
            : request.computer.readOnly
              ? "It will be able to read files there"
              : "It will be able to run commands and change files there"
      }
      buttons={
        request.canAnswer ? (
          <>
            <Button
              title="Don’t allow"
              kind="grey"
              size="medium"
              style={{ flex: 1 }}
              disabled={answer.busy}
              onPress={() => decide(false)}
            />
            <Button
              title="Allow"
              size="medium"
              color={accent.a}
              onColor={accent.onA}
              style={{ flex: 1 }}
              disabled={answer.busy}
              onPress={() => decide(true)}
            />
          </>
        ) : undefined
      }
    >
      <Text variant="headline">{request.computer.name}</Text>
      {request.reason === "" ? null : (
        <Text variant="subhead" tone="ink2">
          “{request.reason}”
        </Text>
      )}
    </Card>
  )
}

function SignInCard({
  connector,
  agentId,
  agentName,
  accent,
}: Shared & { connector: ConnectorSummary }) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = client.agent(agentId)
  const answer = useAnswer(() =>
    queryClient.invalidateQueries({ queryKey: keys.connectors(agentId) }),
  )
  const signIn = () =>
    void answer.run(async () => {
      const result = await api.reconnectConnector(connector.id)
      if (!result.authorizationUrl) return
      // The service is reached in a browser over the app, which comes back here when it is done.
      const WebBrowser = await import("expo-web-browser")
      await WebBrowser.openAuthSessionAsync(result.authorizationUrl)
    })
  return (
    <Card
      icon="plug"
      lead={`${agentName} added a connector, which needs you to sign in`}
      error={answer.error}
      buttons={
        <>
          <Button
            title="Not now"
            kind="grey"
            size="medium"
            style={{ flex: 1 }}
            disabled={answer.busy}
            onPress={() => void answer.run(() => api.dismissConnector(connector.id))}
          />
          <Button
            title="Sign in"
            size="medium"
            color={accent.a}
            onColor={accent.onA}
            style={{ flex: 1 }}
            busy={answer.busy}
            onPress={signIn}
          />
        </>
      }
    >
      <Text variant="headline">{connector.name}</Text>
      <Text variant="footnote" tone="ink2">
        You sign in at {hostOf(connector.url)} and come back here. {agentName} never sees your
        password.
      </Text>
    </Card>
  )
}

/** Where a request came from, for one shown in another chat of the agent than the one it was made in. */
function AskedElsewhere({
  agentId,
  chatId,
  subagent,
  accent,
}: {
  agentId: string
  chatId: string
  /** The sub-agent that asked through the main chat, where one did. */
  subagent?: { title: string } | undefined
  accent: Accent
}) {
  const router = useRouter()
  return (
    <>
      {" "}
      {subagent === undefined ? "Asked in" : "From the sub-agent"}{" "}
      <Text
        variant="footnote"
        color={accent.ink}
        accessibilityRole="link"
        onPress={() => router.push(`/a/${agentId}/c/${chatId}`)}
      >
        {subagent?.title ?? "another chat"}
      </Text>
      .
    </>
  )
}

/**
 * One thing to type in a card. A secret is hidden as it goes in, with an eye to look at it
 * while it is still here.
 */
function TypedField({
  label,
  name,
  description = null,
  secret = false,
  mono: code = false,
  value,
  busy,
  accent,
  onChangeText,
  input,
}: {
  label: string
  /** What it is called where its eye is named: "Show password". */
  name: string
  description?: string | null
  secret?: boolean
  /** Whether its label is a name as code has it, such as an environment variable's. */
  mono?: boolean
  value: string
  busy: boolean
  accent: Accent
  onChangeText: (text: string) => void
  /**
   * What the box is to the system: its keypad, and what the phone may fill it in with. Unsaid,
   * nothing fills it in.
   */
  input?: Pick<TextInputProps, "keyboardType" | "maxLength" | "textContentType" | "autoComplete">
}) {
  const theme = useTheme()
  const [visible, setVisible] = useState(false)
  return (
    <View style={{ gap: 3 }}>
      <Text variant="caption" weight="600" style={code ? { fontFamily: mono } : undefined}>
        {label}
      </Text>
      {description === null ? null : (
        <Text variant="caption" tone="ink2">
          {description}
        </Text>
      )}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.fill,
          borderRadius: radius.sm,
          paddingLeft: 10,
        }}
      >
        <TextInput
          accessibilityLabel={label}
          secureTextEntry={secret && !visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          textContentType="none"
          spellCheck={false}
          {...input}
          editable={!busy}
          value={value}
          onChangeText={onChangeText}
          selectionColor={accent.a}
          style={{
            flex: 1,
            height: 38,
            color: theme.ink,
            fontFamily: mono,
            fontSize: 14,
            padding: 0,
          }}
        />
        {secret ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${visible ? "Hide" : "Show"} ${name}`}
            accessibilityState={{ selected: visible }}
            onPress={() => setVisible(!visible)}
            hitSlop={6}
            style={{
              width: 38,
              height: 38,
              alignItems: "center",
              justifyContent: "center",
              opacity: visible ? 1 : 0.55,
            }}
          >
            <Icon name="eye" size={17} color={theme.ink2} />
          </Pressable>
        ) : null}
      </View>
    </View>
  )
}

/**
 * The sites a login asked for in a chat is to be typed on, as small pills, with a box to add
 * another. The site the Dood asked about is always among them and cannot be taken out.
 */
function SitePills({
  sites,
  fixed,
  typed,
  busy,
  accent,
  onSites,
  onTyped,
  onProblem,
}: {
  sites: readonly string[]
  fixed: string
  typed: string
  busy: boolean
  accent: Accent
  onSites: (sites: string[]) => void
  onTyped: (typed: string) => void
  onProblem: (problem: string | undefined) => void
}) {
  const theme = useTheme()
  const add = useSiteAdder({ sites, typed, onSites, onTyped, onProblem })
  const pill = {
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 10,
  } as const
  return (
    <View style={{ gap: 3 }}>
      <Text variant="caption" weight="600">
        Used only on
      </Text>
      <View
        accessibilityRole="list"
        accessibilityLabel="Used only on"
        style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
      >
        {sites.map((site) => (
          <View key={site} style={[pill, { paddingRight: site === fixed ? 10 : 4 }]}>
            <Text style={{ fontFamily: mono, fontSize: 13 }}>{site}</Text>
            {site === fixed ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${site}`}
                disabled={busy}
                hitSlop={6}
                onPress={() => {
                  onProblem(undefined)
                  onSites(sites.filter((each) => each !== site))
                }}
                style={{ width: 20, height: 20, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={11} color={theme.ink2} weight="bold" />
              </Pressable>
            )}
          </View>
        ))}
        {sites.length >= MAX_LOGIN_SITES && typed === "" ? null : (
          <TextInput
            {...SITE_INPUT}
            placeholder="Add a site"
            placeholderTextColor={theme.ink3}
            editable={!busy}
            value={typed}
            onChangeText={(text) => {
              onProblem(undefined)
              onTyped(text)
            }}
            onSubmitEditing={() => add(true)}
            onBlur={() => add(false)}
            selectionColor={accent.a}
            style={[
              pill,
              {
                minWidth: 110,
                paddingRight: 10,
                color: theme.ink,
                fontFamily: mono,
                fontSize: 13,
                paddingVertical: 0,
              },
            ]}
          />
        )}
      </View>
    </View>
  )
}

/**
 * The form for a login an agent asked for, to sign in on a site with. It is kept by the
 * workspace and typed only on the sites named here, the one that asked always among them, as
 * on the web. What is typed is held here only until it is sent, and forgotten when the form
 * goes. The two boxes are named a username and a password to the system, so that the phone's
 * own saved passwords can fill them in.
 */
function LoginCard({
  request,
  site,
  agentId,
  agentName,
  chatId,
  accent,
  team,
  workspaceId,
}: Shared & { request: SecretRequest; site: string; workspaceId: string | undefined }) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = client.agent(agentId)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [sites, setSites] = useState<string[]>([site])
  const [typedSite, setTypedSite] = useState("")
  const [problem, setProblem] = useState<string>()
  const answer = useAnswer(() => queryClient.invalidateQueries({ queryKey: keys.secrets(agentId) }))
  const save = () => {
    const sent = loginAnswer(site, { username, password, sites, site: typedSite })
    if ("problem" in sent) return setProblem(sent.problem)
    setProblem(undefined)
    void answer.run(
      () => api.answerSecretRequest(request.id, sent.values, sent.sites),
      () => {
        setPassword("")
        // The workspace has one more login, wherever its list is on screen.
        if (workspaceId !== undefined) {
          void queryClient.invalidateQueries({ queryKey: loginsKey(workspaceId) })
        }
      },
    )
  }
  return (
    <Card
      icon="key"
      lead={`${request.subagent === undefined ? agentName : `${agentName}’s sub-agent ${request.subagent.title}`} needs a login for ${site}`}
      error={problem ?? answer.error}
      note={team === undefined ? undefined : `Anyone in ${team} can answer`}
      buttons={
        <>
          <Button
            title="Not now"
            kind="grey"
            size="medium"
            style={{ flex: 1 }}
            disabled={answer.busy}
            onPress={() => void answer.run(() => api.declineSecretRequest(request.id))}
          />
          <Button
            title="Save"
            size="medium"
            color={accent.a}
            onColor={accent.onA}
            style={{ flex: 1 }}
            busy={answer.busy}
            onPress={save}
          />
        </>
      }
    >
      {request.purpose === null ? null : <Text variant="subhead">“{request.purpose}”</Text>}
      <Text variant="footnote" tone="ink2">
        Kept encrypted by Do Computer. {agentName} can sign in with it on the sites below and cannot
        read it.
        {request.chatId === chatId ? null : (
          <AskedElsewhere
            agentId={agentId}
            chatId={request.chatId}
            subagent={request.subagent}
            accent={accent}
          />
        )}
      </Text>
      <TypedField
        label="Username or email"
        name="username"
        value={username}
        busy={answer.busy}
        accent={accent}
        onChangeText={(text) => {
          setProblem(undefined)
          setUsername(text)
        }}
        input={{
          textContentType: "username",
          autoComplete: "username",
          keyboardType: "email-address",
        }}
      />
      <TypedField
        label="Password"
        name="password"
        secret
        value={password}
        busy={answer.busy}
        accent={accent}
        onChangeText={(text) => {
          setProblem(undefined)
          setPassword(text)
        }}
        input={{ textContentType: "password", autoComplete: "current-password" }}
      />
      <SitePills
        sites={sites}
        fixed={site}
        typed={typedSite}
        busy={answer.busy}
        accent={accent}
        onSites={(next) => {
          setProblem(undefined)
          setSites(next)
        }}
        onTyped={setTypedSite}
        onProblem={setProblem}
      />
    </Card>
  )
}

/** Why a value cannot be saved, or undefined when it can. */
function problemWith(name: string, value: string): string | undefined {
  if (value === "") return `Type a value for ${name}.`
  if (/[\r\n]/.test(value)) return `${name} has to be a single line.`
  if (value.length > MAX_SECRET_CHARS) return `${name} is too long to save.`
  return undefined
}

/**
 * The form for secrets an agent asked for. What is typed goes to where it is kept and is never
 * put in the chat: it is held here only until it is sent, and forgotten when the form goes.
 */
function SecretCard({
  request,
  agentId,
  agentName,
  chatId,
  accent,
  team,
  destination,
}: Shared & {
  request: SecretRequest
  destination: Exclude<SecretRequest["destination"], { kind: "login" }>
}) {
  const { client } = useSession()
  const queryClient = useQueryClient()
  const api = client.agent(agentId)
  const [values, setValues] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string>()
  const answer = useAnswer(() => queryClient.invalidateQueries({ queryKey: keys.secrets(agentId) }))
  const one = request.fields.length === 1
  const save = () => {
    const wrong = request.fields
      .map((field) => problemWith(field.name, values[field.name] ?? ""))
      .find((found) => found !== undefined)
    setProblem(wrong)
    if (wrong === undefined) {
      void answer.run(
        () => api.answerSecretRequest(request.id, values),
        () => setValues({}),
      )
    }
  }
  // A sub-agent's request is shown in the main chat under its name.
  const asker =
    request.subagent === undefined
      ? agentName
      : `${agentName}’s sub-agent ${request.subagent.title}`
  return (
    <Card
      icon="key"
      lead={
        destination.kind === "connector"
          ? `${asker} asks for the access token of ${destination.name}`
          : one
            ? `${asker} asks for a secret`
            : `${asker} asks for ${request.fields.length} secrets`
      }
      error={problem ?? answer.error}
      note={team === undefined ? undefined : `Anyone in ${team} can answer`}
      buttons={
        <>
          <Button
            title="Not now"
            kind="grey"
            size="medium"
            style={{ flex: 1 }}
            disabled={answer.busy}
            onPress={() => void answer.run(() => api.declineSecretRequest(request.id))}
          />
          <Button
            title={one ? "Save secret" : "Save secrets"}
            size="medium"
            color={accent.a}
            onColor={accent.onA}
            style={{ flex: 1 }}
            busy={answer.busy}
            onPress={save}
          />
        </>
      }
    >
      {request.purpose === null ? null : <Text variant="subhead">“{request.purpose}”</Text>}
      <Text variant="footnote" tone="ink2">
        {destination.kind === "connector"
          ? `Kept with the connector at ${hostOf(destination.url)} and sent only there.`
          : `Saved to ${destination.path} on ${destination.computer}.`}{" "}
        What you type is not put in the chat or shown to {agentName}.
        {request.chatId === chatId ? null : (
          <AskedElsewhere
            agentId={agentId}
            chatId={request.chatId}
            subagent={request.subagent}
            accent={accent}
          />
        )}
      </Text>
      {request.fields.map((field) => {
        const label = destination.kind === "connector" ? "Access token" : field.name
        return (
          <TypedField
            key={field.name}
            label={label}
            name={field.name}
            description={field.description}
            secret
            mono
            value={values[field.name] ?? ""}
            busy={answer.busy}
            accent={accent}
            onChangeText={(text) => {
              setProblem(undefined)
              setValues((current) => ({ ...current, [field.name]: text }))
            }}
          />
        )
      })}
    </Card>
  )
}

/**
 * What the agent is waiting for its person to answer, stacked above the message box in every
 * chat of the agent: a request from a scheduled run has no chat they would otherwise be looking
 * at. More than two fold to the first and a line that opens the rest.
 */
export function Asks(
  props: Shared & { /** How tall the stack may be before it scrolls. */ maxHeight: number },
) {
  const { agentId, agentName, accent } = props
  const { client } = useSession()
  const [all, setAll] = useState(false)
  const workspaceId = useAgentSummary(agentId)?.workspaceId
  const workspace = useWorkspaces().data?.workspaces.find((each) => each.id === workspaceId)
  const approvals = useQuery<ApprovalsState>({
    queryKey: keys.approvals(agentId),
    queryFn: () => client.agent(agentId).approvals(),
  })
  const computers = useQuery<ComputerRequest[]>({
    queryKey: keys.computerRequests,
    queryFn: () => client.computerRequests(),
    // Someone else's agent may ask for a computer of the reader's, and nothing tells this
    // screen: the web app asks again this often too.
    refetchInterval: 15_000,
  })
  const connectors = useQuery<ConnectorSummary[]>({
    queryKey: keys.connectors(agentId),
    queryFn: () => client.agent(agentId).connectors(),
  })
  const secrets = useQuery<SecretRequest[]>({
    queryKey: keys.secrets(agentId),
    queryFn: () => client.agent(agentId).secretRequests(),
  })
  const cards: ReactNode[] = [
    ...(approvals.data?.pending ?? []).map((request) => (
      <ApprovalCard key={`a${request.id}`} {...props} request={request} />
    )),
    ...(computers.data ?? [])
      .filter((request) => request.agentId === agentId)
      .map((request) => (
        <ComputerCard
          key={`c${request.id}`}
          request={request}
          agentName={agentName}
          accent={accent}
        />
      )),
    ...(connectors.data ?? [])
      .filter((connector) => connector.status === "needs_auth" && connector.askedIn !== undefined)
      .map((connector) => <SignInCard key={`s${connector.id}`} {...props} connector={connector} />),
    // A login is asked for only where the workspace keeps logins and this person may give one,
    // as on the web.
    ...(secrets.data ?? [])
      .filter((request) => request.destination.kind !== "login" || workspace?.savedLogins === true)
      .map((request) => {
        const { destination } = request
        return destination.kind === "login" ? (
          <LoginCard
            key={`k${request.id}`}
            {...props}
            request={request}
            site={destination.site}
            workspaceId={workspaceId}
          />
        ) : (
          <SecretCard
            key={`k${request.id}`}
            {...props}
            request={request}
            destination={destination}
          />
        )
      }),
  ]
  if (cards.length === 0) return null
  const folded = cards.length > 2 && !all
  return (
    <ScrollView
      accessibilityLabel="Waiting for your OK"
      style={{ maxHeight: props.maxHeight, flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {folded ? cards[0] : cards}
      {cards.length > 2 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            haptic.tap()
            setAll(!all)
          }}
          style={{ alignSelf: "center" }}
        >
          <Glass
            interactive
            style={{ borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 }}
          >
            <Text variant="footnote" weight="600">
              {folded ? `${cards.length - 1} more` : "Show fewer"}
            </Text>
          </Glass>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}
