import type { SiteSummary } from "@durable-computer/protocol"
import { CheckIcon, CopyIcon, GlobeIcon, LinkSimpleIcon, LockIcon } from "@phosphor-icons/react"
import { type ReactElement, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { shownAddress, siteUrl, useAudience, useSharing } from "@/lib/sites"
import { cn } from "@/lib/utils"

/** Who can open a site, as a word beside it: the workspace's people, or anyone. */
export function SitePill({
  agentId,
  site,
  className,
}: {
  agentId: string
  site: Pick<SiteSummary, "public">
  className?: string
}) {
  const audience = useAudience(agentId)
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded-full px-2 text-[0.6875rem] font-medium whitespace-nowrap",
        site.public
          ? "bg-primary/15 text-primary dark:text-foreground"
          : "bg-accent text-muted-foreground",
        className,
      )}
    >
      {site.public ? <GlobeIcon className="size-3" /> : <LockIcon className="size-3" />}
      {site.public ? "Public" : audience.short}
    </span>
  )
}

/** Copies a site's address, and says that it has. */
export function CopyLink({
  url,
  label = "Copy link",
  iconOnly = false,
}: {
  url: string
  label?: string
  iconOnly?: boolean
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      variant={iconOnly ? "ghost" : "outline"}
      size={iconOnly ? "icon-sm" : "sm"}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
      onClick={async () => {
        await navigator.clipboard.writeText(url).catch(() => {})
        setCopied(true)
        setTimeout(() => setCopied(false), 1_500)
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {iconOnly ? null : copied ? "Copied" : label}
    </Button>
  )
}

function Choice({
  value,
  icon,
  title,
  line,
}: {
  value: string
  icon: ReactElement
  title: string
  line: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{line}</span>
      </span>
      <RadioGroupItem value={value} aria-label={title} />
    </label>
  )
}

/**
 * Whether something in the library is shared with a link, and who can open it. For one that is
 * not shared yet, the way to share it; for one that is, its address, the choice of who can open
 * it, and the way to stop.
 */
export function ShareControls({
  agentId,
  site,
  path,
  title,
}: {
  agentId: string
  site: SiteSummary | undefined
  /** What would be shared, where nothing is yet. */
  path: string
  title?: string | undefined
}) {
  const audience = useAudience(agentId)
  const { share, open, stop, error } = useSharing(agentId)
  if (site === undefined) {
    return (
      <>
        <PopoverTitle className="flex items-center gap-2 text-sm font-semibold">
          <LinkSimpleIcon className="size-4" /> Share with a link
        </PopoverTitle>
        <p className="text-sm text-muted-foreground">
          This gives it a link of its own, which shows it as it is in the library.{" "}
          {audience.long === "Only you"
            ? "Only you can open it until you make it public."
            : `${audience.long} can open it, and nobody else until you make it public.`}
        </p>
        <Button
          disabled={share.isPending}
          onClick={() => share.mutate({ path, ...(title === undefined ? {} : { title }) })}
        >
          Share
        </Button>
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error.message}
          </p>
        ) : null}
      </>
    )
  }
  const url = siteUrl(site.id)
  return (
    <>
      <PopoverTitle className="flex items-center gap-2 text-sm font-semibold">
        <LinkSimpleIcon className="size-4" /> Shared with a link
      </PopoverTitle>
      <div className="flex items-center gap-1 rounded-lg border bg-surface py-1 pr-1 pl-3">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 flex-1 truncate font-mono text-xs hover:underline"
        >
          {shownAddress(url)}
        </a>
        <CopyLink url={url} label="Copy" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="px-2 text-[0.8125rem] font-medium text-muted-foreground">Who can open it</p>
        <RadioGroup
          aria-label="Who can open it"
          className="gap-0"
          value={site.public ? "public" : "workspace"}
          disabled={open.isPending}
          onValueChange={(value) => open.mutate({ siteId: site.id, public: value === "public" })}
        >
          <Choice
            value="workspace"
            icon={<LockIcon className="size-4" />}
            title={audience.long}
            line={audience.who}
          />
          <Choice
            value="public"
            icon={<GlobeIcon className="size-4" />}
            title="Anyone with the link"
            line="No sign-in needed"
          />
        </RadioGroup>
      </div>
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error.message}
        </p>
      ) : null}
      <div className="-mx-4 -mb-4 border-t px-2 py-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={stop.isPending}
          onClick={() => stop.mutate(site.id)}
        >
          Stop sharing
        </Button>
      </div>
    </>
  )
}

/** The share controls, opened from whatever `children` is: a button on a card, a row or a page. */
export function SharePopover({
  agentId,
  site,
  path,
  title,
  children,
  align = "end",
}: {
  agentId: string
  site: SiteSummary | undefined
  path: string
  title?: string | undefined
  /** The button that opens it. */
  children: ReactElement
  align?: "start" | "center" | "end"
}) {
  return (
    <Popover>
      <PopoverTrigger render={children} />
      <PopoverContent align={align} className="w-88 max-w-[calc(100vw-2rem)] gap-3">
        <ShareControls agentId={agentId} site={site} path={path} title={title} />
      </PopoverContent>
    </Popover>
  )
}
