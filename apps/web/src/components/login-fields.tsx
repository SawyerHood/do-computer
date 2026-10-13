import { MAX_LOGIN_SITES } from "@do-computer/protocol"
import { EyeIcon, EyeSlashIcon, PlusIcon, XIcon } from "@phosphor-icons/react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { withSite } from "@/lib/passwords"
import { cn } from "@/lib/utils"

/**
 * Where a password is typed: hidden as it goes in, with an eye to look at it while it is still
 * here. Nothing fills it in or offers to keep it, since it is not this person's sign-in to the app.
 */
export function PasswordInput({
  id,
  name,
  value,
  onChange,
  disabled,
  autoFocus,
  className,
}: {
  id: string
  /** What it is called where its eye is named: "Show password". */
  name: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  autoFocus?: boolean
  className?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        // Not the person's own password for this app, which a browser would otherwise put here.
        autoComplete="new-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn("pr-10 font-mono", className)}
      />
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="absolute top-1/2 right-1 size-7 -translate-y-1/2 text-muted-foreground"
        aria-label={`${visible ? "Hide" : "Show"} ${name}`}
        aria-pressed={visible}
        disabled={disabled}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeSlashIcon /> : <EyeIcon />}
      </Button>
    </div>
  )
}

/**
 * The sites a login is used on, each as its host, with a way to add another. What is being
 * typed for the next one is the form's to hold, so that saving can add it or refuse it.
 */
export function SitesField({
  id,
  sites,
  fixed,
  typed,
  disabled,
  onSites,
  onTyped,
  onProblem,
}: {
  id: string
  sites: readonly string[]
  /** The one that cannot be taken out: the site a Dood asked for the login on. */
  fixed?: string
  /** What is typed of a site not yet added. */
  typed: string
  disabled?: boolean
  onSites: (sites: string[]) => void
  onTyped: (typed: string) => void
  /** Why what was typed could not be added, or undefined once it could. */
  onProblem: (problem: string | undefined) => void
}) {
  const [adding, setAdding] = useState(false)
  const full = sites.length >= MAX_LOGIN_SITES
  /** Adds what is typed. Something that is not a site stays in the box, to be put right. */
  const add = (loud: boolean) => {
    if (typed.trim() === "") return setAdding(false)
    const added = withSite(sites, typed)
    if ("problem" in added) {
      if (loud) onProblem(added.problem)
      return
    }
    onProblem(undefined)
    onSites(added.sites)
    onTyped("")
    setAdding(false)
  }
  return (
    <ul aria-labelledby={`${id}-label`} className="flex flex-wrap items-center gap-1.5">
      {sites.map((site) => (
        <li
          key={site}
          className="inline-flex h-7 items-center gap-1 rounded-full bg-accent pr-1 pl-2.5 font-mono text-[0.8125rem]"
          translate="no"
        >
          {site}
          {site === fixed ? (
            <span className="w-1.5" />
          ) : (
            <button
              type="button"
              aria-label={`Remove ${site}`}
              disabled={disabled}
              className="grid size-5 place-items-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
              onClick={() => {
                onProblem(undefined)
                onSites(sites.filter((each) => each !== site))
              }}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </li>
      ))}
      {/* With no site yet there is nothing to add one to: the box is there to be typed in. */}
      {adding || typed !== "" || sites.length === 0 ? (
        <li>
          <Input
            id={id}
            aria-label="A site to add"
            placeholder="example.com"
            autoFocus={adding}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="url"
            disabled={disabled}
            value={typed}
            onChange={(event) => {
              onProblem(undefined)
              onTyped(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                // Enter adds the site. The login is saved with its own button.
                event.preventDefault()
                add(true)
              } else if (event.key === "Escape" && typed !== "") {
                event.stopPropagation()
                onProblem(undefined)
                onTyped("")
                setAdding(false)
              }
            }}
            onBlur={() => add(false)}
            className="h-7 w-44 rounded-full px-2.5 font-mono text-[0.8125rem]"
          />
        </li>
      ) : full ? null : (
        <li>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-[0.8125rem] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40"
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="size-3" />
            Add a site
          </button>
        </li>
      )}
    </ul>
  )
}
