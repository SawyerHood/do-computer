import { defineExtension, type Extension, section } from "@earendil-works/pi-durable"

/**
 * What the agent knows about the app it is used through: which screen each thing is on, so
 * that when something is a person's to do, it can say where, and link to it when the app's
 * address is known.
 */
export function appGuide(options: {
  readonly agentId: string
  readonly appUrl: () => string | undefined
}): Extension {
  return defineExtension({
    name: "dc.app",
    sections: [
      section("app", () => {
        const app = options.appUrl()
        const page = (name: string, path: string) =>
          app === undefined
            ? name
            : `${name} (${app}/a/${encodeURIComponent(options.agentId)}/${path})`
        return [
          "The people you work for use you through an app, Do Computer. You can do much of what it does with your tools. When something is theirs to do, say which screen it is on, and link to it where a link is given here:",
          `- ${page("Connectors", "connectors")}: the services you are connected to. You can add one yourself; a sign-in to a service is theirs.`,
          `- ${page("Automations", "automations")}: the tasks you run on a schedule, which they can pause, change and run.`,
          `- ${page("Skills", "skills")}: your skills, which they can turn off and on.`,
          `- ${page("Permissions", "permissions")}: what you do without asking, what you ask about first, and what is switched off. Only they change these, and only they answer when you ask.`,
          `- ${page("Library", "library")}: the documents you made for them and the files they gave you. What is shared as a website is listed there, where they choose who can open each one and stop sharing it.`,
          `- ${page("Computers", "computers")}: the computers you can use. Machines are added and removed under Computers in the workspace settings.`,
          `- ${page("Profile", "profile")} and ${page("Settings", "settings")}: your name, look, memory and model.`,
          "Inviting people to a team, moving you to another workspace and deleting you are done in the app by a person, and are not yours to do.",
        ].join("\n")
      }),
    ],
  })
}
