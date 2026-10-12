import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { personalWorkspaceId } from "@do-computer/protocol"
import { openNodeAppDatabase } from "@do-computer/runtime/node"
import { describe, expect, it } from "vitest"
import { browserDirectory } from "./browser-directory.ts"
import { migrateAppDatabase } from "./schema.ts"
import {
  acceptInvitation,
  agentAccess,
  createWorkspace,
  declineInvitation,
  deleteWorkspace,
  invitationsFor,
  invite,
  type InviteDeps,
  isInvited,
  listInvitations,
  listWorkspaces,
  mayRemoveAgent,
  peopleOfAgent,
  previewInvitation,
  Refusal,
  removeMember,
  renewInvitation,
  setRole,
  showsBrowser,
  updateWorkspace,
  updateWorkspaceOptions,
  type Who,
  withdrawInvitation,
  workspaceOptions,
} from "./teams.ts"

const person = (id: string, verified = true): Who => ({
  id,
  name: id[0]!.toUpperCase() + id.slice(1),
  email: `${id}@example.com`,
  emailVerified: verified,
})
const sawyer = person("sawyer")
const maya = person("maya")
const jon = person("jon")
const priya = person("priya")

async function database() {
  const { app } = openNodeAppDatabase(join(mkdtempSync(join(tmpdir(), "dc-teams-")), "app.sqlite"))
  await migrateAppDatabase(app)
  // The parts of Better Auth's tables that teams read.
  await app.run("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, image TEXT)")
  await app.run("CREATE TABLE account (accountId TEXT, providerId TEXT, userId TEXT)")
  for (const who of [sawyer, maya, jon, priya]) {
    await app.run(
      "INSERT INTO user (id, name, email) VALUES (?, ?, ?)",
      who.id,
      who.name,
      who.email,
    )
  }
  return app
}

function deps(
  over: Partial<InviteDeps> = {},
): InviteDeps & { sent: { to: string; text: string }[] } {
  const sent: { to: string; text: string }[] = []
  return {
    origin: "https://app.example",
    now: () => 1_000,
    github: async (login) =>
      login.toLowerCase() === "danvega" ? { id: "4242", login: "danvega", name: "Dan" } : undefined,
    email: async (message) => {
      sent.push(message)
      return true
    },
    sent,
    ...over,
  }
}

const tokenOf = (link: string) => link.slice(link.lastIndexOf("/") + 1)

/** A team of Sawyer's with Maya in it as an admin and Jon as a member. */
async function team(db: Awaited<ReturnType<typeof database>>) {
  const id = await createWorkspace(db, sawyer, { name: "Tidewater" }, 500)
  const sent = await invite(db, sawyer, id, { who: [maya.email, jon.email] }, deps())
  for (const [index, who] of [maya, jon].entries()) {
    await acceptInvitation(db, who, tokenOf(sent.invitations[index]!.link), 1_000)
  }
  await setRole(db, sawyer, id, maya.id, "admin")
  return id
}

const refused = async (work: Promise<unknown>) => {
  const error = await work.then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(Refusal)
  return (error as Refusal).status
}

describe("teams", () => {
  it("gives everyone a personal workspace, and lists the teams they are in", async () => {
    const db = await database()
    expect(await listWorkspaces(db, sawyer)).toMatchObject([
      { id: personalWorkspaceId("sawyer"), kind: "personal", role: "owner" },
    ])
    const id = await team(db)
    const [, tidewater] = await listWorkspaces(db, jon)
    expect(tidewater).toMatchObject({ id, name: "Tidewater", kind: "team", role: "member" })
    expect(tidewater!.members.map((member) => [member.name, member.role])).toEqual([
      ["Sawyer", "owner"],
      ["Maya", "admin"],
      ["Jon", "member"],
    ])
    expect(await listWorkspaces(db, priya)).toHaveLength(1)
  })

  it("lets the members of an agent's workspace reach it, and nobody else", async () => {
    const db = await database()
    const id = await team(db)
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('shared', 'sawyer', ?, 1)",
      id,
    )
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('mine', 'sawyer', ?, 1)",
      personalWorkspaceId("sawyer"),
    )
    // An agent from before teams has no workspace on record: it is its owner's.
    await db.run("INSERT INTO dc_agents (id, owner_id, created_at) VALUES ('old', 'sawyer', 1)")

    expect(await agentAccess(db, "jon", "shared")).toMatchObject({
      role: "member",
      workspaceId: id,
    })
    expect(await agentAccess(db, "priya", "shared")).toBeUndefined()
    for (const agent of ["mine", "old"]) {
      expect(await agentAccess(db, "sawyer", agent)).toMatchObject({ role: "owner" })
      expect(await agentAccess(db, "maya", agent)).toBeUndefined()
    }
    expect(await agentAccess(db, "sawyer", "nothing")).toBeUndefined()

    // Deleting or moving a team's agent is for its admins.
    expect(mayRemoveAgent((await agentAccess(db, "jon", "shared"))!)).toBe(false)
    expect(mayRemoveAgent((await agentAccess(db, "maya", "shared"))!)).toBe(true)
    expect((await peopleOfAgent(db, "shared")).sort()).toEqual(["jon", "maya", "sawyer"])
    expect(await peopleOfAgent(db, "old")).toEqual(["sawyer"])

    // Out of the team, out of its agents.
    await removeMember(db, maya, id, "jon")
    expect(await agentAccess(db, "jon", "shared")).toBeUndefined()
  })

  it("shows the browser its agents use until an admin says otherwise", async () => {
    const db = await database()
    const id = await team(db)
    const own = personalWorkspaceId("sawyer")
    // Nobody has chosen anything, so it is shown, in a team and in a workspace of one's own.
    expect(await workspaceOptions(db, sawyer, id)).toEqual({ showBrowser: true, canChange: true })
    expect(await workspaceOptions(db, maya, id)).toEqual({ showBrowser: true, canChange: true })
    expect(await workspaceOptions(db, jon, id)).toEqual({ showBrowser: true, canChange: false })
    expect(await workspaceOptions(db, sawyer, own)).toEqual({ showBrowser: true, canChange: true })

    // A member reads the choice and cannot change it; someone outside is not told of the team.
    expect(await refused(updateWorkspaceOptions(db, jon, id, { showBrowser: false }))).toBe(403)
    expect(await refused(updateWorkspaceOptions(db, priya, id, { showBrowser: false }))).toBe(404)
    expect(await refused(workspaceOptions(db, priya, id))).toBe(404)
    expect(await refused(workspaceOptions(db, maya, own))).toBe(404)
    expect(await refused(updateWorkspaceOptions(db, maya, own, { showBrowser: false }))).toBe(404)
    expect(await refused(updateWorkspaceOptions(db, maya, id, { showBrowser: "no" }))).toBe(400)
    expect(await showsBrowser(db, id)).toBe(true)

    await updateWorkspaceOptions(db, maya, id, { showBrowser: false })
    expect(await workspaceOptions(db, jon, id)).toEqual({ showBrowser: false, canChange: false })
    // Each workspace chooses for itself.
    expect(await showsBrowser(db, own)).toBe(true)
    await updateWorkspaceOptions(db, sawyer, own, { showBrowser: false })
    expect(await showsBrowser(db, own)).toBe(false)

    // An agent is answered with what the workspace it is in now has chosen.
    const shown = browserDirectory(db)
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('shared', 'maya', ?, 1)",
      id,
    )
    await db.run("INSERT INTO dc_agents (id, owner_id, created_at) VALUES ('hers', 'maya', 2)")
    expect(await shown("shared")).toBe(false)
    expect(await shown("hers")).toBe(true)
    expect(await shown("nobody")).toBeUndefined()
    await updateWorkspaceOptions(db, sawyer, id, { showBrowser: true })
    expect(await shown("shared")).toBe(true)

    // A deleted team's choice goes with it.
    await updateWorkspaceOptions(db, sawyer, id, { showBrowser: false })
    await db.run("DELETE FROM dc_agents WHERE id = 'shared'")
    await deleteWorkspace(db, sawyer, id)
    expect(await showsBrowser(db, id)).toBe(true)
  })

  it("keeps who may change a team to its admins and owner", async () => {
    const db = await database()
    const id = await team(db)
    expect(await refused(updateWorkspace(db, jon, id, { name: "Mine now" }))).toBe(403)
    expect(await refused(updateWorkspace(db, priya, id, { name: "Mine now" }))).toBe(404)
    expect(
      await updateWorkspace(db, maya, id, { name: " Tidewater Studio ", color: "moss" }),
    ).toEqual({
      name: "Tidewater Studio",
    })
    expect(await refused(updateWorkspace(db, maya, id, { color: "beige" }))).toBe(400)
    expect(
      await refused(updateWorkspace(db, sawyer, personalWorkspaceId("sawyer"), { name: "x" })),
    ).toBe(404)

    // Only the owner makes admins, and an admin cannot remove another admin or the owner.
    expect(await refused(setRole(db, maya, id, jon.id, "admin"))).toBe(403)
    expect(await refused(removeMember(db, maya, id, sawyer.id))).toBe(409)
    expect(await refused(removeMember(db, jon, id, maya.id))).toBe(403)
    // The owner cannot walk away from the team, but can hand it on and then leave.
    expect(await refused(removeMember(db, sawyer, id, sawyer.id))).toBe(409)
    await setRole(db, sawyer, id, maya.id, "owner")
    expect((await listWorkspaces(db, sawyer))[1]).toMatchObject({ role: "admin" })
    expect((await listWorkspaces(db, maya))[1]).toMatchObject({ role: "owner" })
    await removeMember(db, sawyer, id, sawyer.id)
    expect(await listWorkspaces(db, sawyer)).toHaveLength(1)

    // A team with agents in it is not deleted from under them.
    await db.run(
      "INSERT INTO dc_agents (id, owner_id, workspace_id, created_at) VALUES ('shared', 'maya', ?, 1)",
      id,
    )
    expect(await refused(deleteWorkspace(db, jon, id))).toBe(403)
    expect(await refused(deleteWorkspace(db, maya, id))).toBe(409)
    await db.run("DELETE FROM dc_agents")
    await deleteWorkspace(db, maya, id)
    expect(await listWorkspaces(db, jon)).toHaveLength(1)
  })

  it("invites by email with a link that works once", async () => {
    const db = await database()
    const id = await createWorkspace(db, sawyer, { name: "Tidewater" })
    const mail = deps()
    const result = await invite(
      db,
      sawyer,
      id,
      { who: ["Priya@Example.com", "not an address", sawyer.email], note: "Come and see." },
      mail,
    )
    expect(result.problems).toEqual([
      { who: "not an address", error: "That is not an email address or a GitHub username." },
      { who: sawyer.email, error: "They are already in this team." },
    ])
    expect(result.invitations).toMatchObject([{ email: "priya@example.com", emailed: true }])
    const { link } = result.invitations[0]!
    expect(mail.sent).toMatchObject([{ to: "priya@example.com" }])
    expect(mail.sent[0]!.text).toContain(link)
    expect(mail.sent[0]!.text).toContain("Come and see.")

    // Whoever holds the link can see what it is to, signed in or not.
    const token = tokenOf(link)
    expect(await previewInvitation(db, token, undefined, 1_000)).toMatchObject({
      workspace: { name: "Tidewater" },
      invitedBy: { name: "Sawyer" },
      note: "Come and see.",
      members: [{ name: "Sawyer" }],
    })
    expect(await previewInvitation(db, "not-the-token", undefined, 1_000)).toBeUndefined()
    // Only the hash of the token is kept.
    expect(JSON.stringify(await db.all("SELECT * FROM dc_invitations"))).not.toContain(token)

    expect(await acceptInvitation(db, priya, token, 2_000)).toEqual({ workspaceId: id })
    expect((await listWorkspaces(db, priya))[1]).toMatchObject({ role: "member" })
    expect(await refused(acceptInvitation(db, jon, token, 2_000))).toBe(404)
    expect(await listInvitations(db, sawyer, id, 2_000)).toEqual([])
  })

  it("shows someone the invitations addressed to them, once the address is known to be theirs", async () => {
    const db = await database()
    const id = await createWorkspace(db, sawyer, { name: "Tidewater" })
    const { invitations } = await invite(db, sawyer, id, { who: [priya.email] }, deps())
    expect(await invitationsFor(db, priya, 1_000)).toMatchObject([
      { workspace: { name: "Tidewater" } },
    ])
    // Anyone can sign up with an address they do not hold. That finds them nothing.
    const impostor = { ...person("priya", false), id: "impostor" }
    expect(await invitationsFor(db, impostor, 1_000)).toEqual([])
    expect(await refused(acceptInvitation(db, impostor, invitations[0]!.id, 1_000))).toBe(404)
    expect(await refused(declineInvitation(db, impostor, invitations[0]!.id, 1_000))).toBe(404)
    // By its id, an invitation is only its addressee's.
    expect(await refused(acceptInvitation(db, jon, invitations[0]!.id, 1_000))).toBe(404)
    expect(await acceptInvitation(db, priya, invitations[0]!.id, 1_000)).toEqual({
      workspaceId: id,
    })
    expect(await invitationsFor(db, priya, 1_000)).toEqual([])
  })

  it("invites a GitHub account by username", async () => {
    const db = await database()
    const id = await createWorkspace(db, sawyer, { name: "Tidewater" })
    const mail = deps()
    const result = await invite(
      db,
      sawyer,
      id,
      { who: ["@DanVega", "nobody-here"], role: "admin" },
      mail,
    )
    expect(result.problems).toEqual([
      { who: "nobody-here", error: "There is no GitHub account with that username." },
    ])
    // There is no address to write to: the sender passes the link on.
    expect(result.invitations).toMatchObject([
      { githubLogin: "danvega", email: null, emailed: false, role: "admin" },
    ])
    expect(mail.sent).toEqual([])
    // It lets that account, and no other, sign up where sign-up is by invitation.
    expect(await isInvited(db, { githubId: "4242", email: "dan@elsewhere.dev" }, 1_000)).toBe(true)
    expect(await isInvited(db, { githubId: "1", email: "dan@elsewhere.dev" }, 1_000)).toBe(false)

    // Once Dan has signed in with GitHub, it is waiting for him.
    const dan: Who = { id: "dan", name: "Dan", email: "dan@elsewhere.dev", emailVerified: true }
    await db.run("INSERT INTO user (id, name, email) VALUES ('dan', 'Dan', 'dan@elsewhere.dev')")
    expect(await invitationsFor(db, dan, 1_000)).toEqual([])
    await db.run(
      "INSERT INTO account (accountId, providerId, userId) VALUES ('4242', 'github', 'dan')",
    )
    const [waiting] = await invitationsFor(db, dan, 1_000)
    expect(waiting).toMatchObject({ workspace: { name: "Tidewater" }, role: "admin" })
    await acceptInvitation(db, dan, waiting!.id, 1_000)
    expect((await listWorkspaces(db, dan))[1]).toMatchObject({ role: "admin" })
    // Someone already in is not asked again.
    expect((await invite(db, sawyer, id, { who: ["danvega"] }, mail)).problems).toEqual([
      { who: "danvega", error: "They are already in this team." },
    ])
  })

  it("expires, renews, replaces and withdraws invitations", async () => {
    const db = await database()
    const id = await team(db)
    expect(await refused(invite(db, jon, id, { who: [priya.email] }, deps()))).toBe(403)
    const first = await invite(db, maya, id, { who: [priya.email] }, deps())
    expect(await isInvited(db, { email: "PRIYA@example.com" }, 1_000)).toBe(true)
    // Asking again replaces what was sent before.
    const second = await invite(db, maya, id, { who: [priya.email] }, deps())
    expect(await listInvitations(db, jon, id, 1_000)).toHaveLength(1)
    expect(
      await previewInvitation(db, tokenOf(first.invitations[0]!.link), undefined, 1_000),
    ).toBeUndefined()

    const week = 7 * 24 * 60 * 60_000
    const old = tokenOf(second.invitations[0]!.link)
    expect(await previewInvitation(db, old, undefined, 1_000 + week + 1)).toBeUndefined()
    expect(await isInvited(db, { email: priya.email }, 1_000 + week + 1)).toBe(false)

    // Sending it again gives it a new link, and the old one stops working.
    const renewed = await renewInvitation(
      db,
      maya,
      id,
      second.invitations[0]!.id,
      deps({ now: () => 5_000 }),
    )
    expect(renewed.expiresAt).toBe(5_000 + week)
    expect(await previewInvitation(db, old, undefined, 5_000)).toBeUndefined()
    expect(await previewInvitation(db, tokenOf(renewed.link), undefined, 5_000)).toBeDefined()

    expect(await refused(withdrawInvitation(db, jon, id, renewed.id))).toBe(403)
    await withdrawInvitation(db, maya, id, renewed.id)
    expect(await refused(acceptInvitation(db, priya, tokenOf(renewed.link), 5_000))).toBe(404)
  })
})
