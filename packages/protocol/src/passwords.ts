/**
 * Saved logins: a username and a password a workspace keeps for its agents to sign in with on
 * the sites each is for. An agent uses one without ever being shown the password, and nobody is
 * shown it again once it is saved: it can be replaced or removed, and that is all.
 */

/**
 * Who has saved logins on a deployment (`DC_SECRETS`). `admins`, which is what an unset one
 * means: those its `DC_ADMIN_EMAILS` names, in a workspace where everyone is one of them.
 */
export type SecretsMode = "off" | "admins" | "on"

/** A saved login as people and agents are shown it: everything but the password. */
export type SavedLogin = {
  id: string
  /** What it is called, by people and by the agent that asks for it. */
  name: string
  username: string
  /** The sites it is typed on, as host names: these and their subdomains, and nowhere else. */
  sites: string[]
  /** Who saved it, where that is known. */
  addedBy: { id: string; name: string } | null
  addedAt: number
  /** When a password was last given for it. */
  changedAt: number
  /** When an agent last signed in with it, and what that agent is called. */
  usedAt: number | null
  usedBy: string | null
  /**
   * True where what is kept can no longer be read: the deployment's key was changed after it
   * was saved. It has to be given its password again before anything can sign in with it.
   */
  unreadable?: true
}

export type SavedLoginsState = { logins: SavedLogin[] }

export type SaveLoginRequest = {
  name: string
  username: string
  password: string
  sites: string[]
}

/** What to change of a saved login. A password given here replaces the one kept. */
export type ChangeLoginRequest = {
  name?: string
  username?: string
  password?: string
  sites?: string[]
}

export const MAX_SAVED_LOGINS = 200
export const MAX_LOGIN_SITES = 8
export const MAX_LOGIN_NAME_CHARS = 60
export const MAX_USERNAME_CHARS = 320
export const MAX_PASSWORD_CHARS = 1024

/** The names the two things asked for in a request for a login go by. */
export const LOGIN_USERNAME = "username"
export const LOGIN_PASSWORD = "password"

/**
 * What a call of the `sign_in` tool leaves with it, for a chat to show: where it signed in, as
 * whom, and how it went. Nothing of the password.
 */
export type SignInDetails = {
  signIn: {
    computer: { id: string; name: string }
    /** The saved login's name. */
    login: string
    username: string
    /** The host of the page, as the browser gave it. */
    site: string | null
    outcome: "signing_in" | "signed_in" | "wrong_site" | "no_form" | "still_asking" | "failed"
  }
}
