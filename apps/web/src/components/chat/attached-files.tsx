import type { MessageImage } from "@do-computer/protocol"
import { CaretLeftIcon, CaretRightIcon, XIcon } from "@phosphor-icons/react"
import { useMemo, useState } from "react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentMedia,
  AttachmentTrigger,
} from "@/components/ui/attachment"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { pictureSrc } from "@/lib/pictures"

/** Something attached to a message: a file in the library, a picture for the agent to look at, or both. */
export type AttachedFile = {
  id: string
  name: string
  /** Whether it is in the library, and so can be named to the agent as a file. */
  stored: boolean
  image?: MessageImage
}

/**
 * What is attached to the message being written, above the box. A picture is shown small, as
 * the agent will be given it, and opens large when it is clicked; any other file is its name.
 * The pictures come first, so that a row of them is not broken up by names.
 */
export function AttachedFiles({
  files,
  uploading,
  note,
  onRemove,
}: {
  files: AttachedFile[]
  /** How many more are on their way. */
  uploading: number
  /** Something to say about the pictures, under them. */
  note?: string | undefined
  onRemove: (id: string) => void
}) {
  // Made once for each picture, not on every key pressed in the box: they are long.
  const pictures = useMemo(
    () =>
      files.flatMap(({ id, name, image }) =>
        image === undefined ? [] : [{ id, name, src: pictureSrc(image) }],
      ),
    [files],
  )
  // Which picture is large is kept after the dialog is shut, so that it does not empty as it fades.
  const [large, setLarge] = useState<string>()
  const [open, setOpen] = useState(false)
  if (files.length === 0 && uploading === 0) return null
  return (
    <>
      <ul aria-label="Attached files" className="flex flex-wrap items-end gap-1.5 px-2">
        {pictures.map((picture) => (
          <li key={picture.id}>
            <Attachment orientation="vertical" size="xs" className="w-auto bg-surface">
              <AttachmentMedia variant="image" className="aspect-3/2 w-24! *:[img]:aspect-3/2">
                <img src={picture.src} alt={picture.name} draggable={false} />
              </AttachmentMedia>
              <AttachmentTrigger
                aria-label={`Open ${picture.name} large`}
                title={picture.name}
                className="cursor-zoom-in rounded-lg focus-visible:ring-3 focus-visible:ring-ring/40"
                onClick={() => {
                  setLarge(picture.id)
                  setOpen(true)
                }}
              />
              <AttachmentActions className="top-1.5! right-1.5!">
                {/* Small on the picture, with more around it to press than there is to see. Its
                    ring is white inside black, to show on a picture of any colour. */}
                <AttachmentAction
                  aria-label={`Remove ${picture.name}`}
                  className="size-5 rounded-full bg-black/60 text-white after:absolute after:-inset-1.5 hover:bg-black/80 hover:text-white focus-visible:border-transparent focus-visible:bg-black focus-visible:shadow-[0_0_0_4px_rgb(0_0_0/0.6)] focus-visible:ring-2 focus-visible:ring-white dark:hover:bg-black/80"
                  onClick={() => onRemove(picture.id)}
                >
                  <XIcon weight="bold" />
                </AttachmentAction>
              </AttachmentActions>
            </Attachment>
          </li>
        ))}
        {files.map((file) =>
          file.image === undefined ? (
            <li key={file.id}>
              <Badge variant="outline" className="h-6 bg-surface pr-0.5 pl-2.5 font-normal">
                <span className="max-w-48 truncate">{file.name}</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${file.name}`}
                  className="size-5 text-muted-foreground"
                  onClick={() => onRemove(file.id)}
                >
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ) : null,
        )}
        {uploading > 0 ? (
          <li className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
            <Spinner className="size-3" /> Attaching…
          </li>
        ) : null}
        {note === undefined ? null : (
          <li role="note" className="basis-full px-1 text-xs text-muted-foreground">
            {note}
          </li>
        )}
      </ul>
      <LargePicture
        pictures={pictures}
        id={large}
        open={open}
        onShow={setLarge}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

type Picture = { id: string; name: string; src: string }

/** One of the attached pictures, large. With several, the arrows go from one to the next. */
function LargePicture({
  pictures,
  id,
  open,
  onShow,
  onClose,
}: {
  pictures: Picture[]
  id: string | undefined
  open: boolean
  onShow: (id: string) => void
  onClose: () => void
}) {
  const at = pictures.findIndex((picture) => picture.id === id)
  const picture = pictures[at]
  // Past either end it comes round to the other.
  const step = (by: number) => {
    const next = pictures[(at + by + pictures.length) % pictures.length]
    if (next !== undefined) onShow(next.id)
  }
  return (
    <Dialog
      open={open && picture !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      {picture === undefined ? null : (
        <DialogContent
          className="flex max-h-[calc(100dvh-2.5rem)] w-auto max-w-[calc(100%-2.5rem)] min-w-64 flex-col gap-0 overflow-hidden p-0 sm:max-w-[calc(100%-2.5rem)]"
          onKeyDown={(event) => {
            if (pictures.length < 2) return
            if (event.key === "ArrowLeft") step(-1)
            if (event.key === "ArrowRight") step(1)
          }}
        >
          <div className="flex h-16 shrink-0 items-center gap-1 border-b pr-14 pl-4">
            <DialogTitle className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {picture.name}
            </DialogTitle>
            {pictures.length > 1 ? (
              <>
                <span className="px-1 text-[13px] text-muted-foreground tabular-nums">
                  {at + 1} of {pictures.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous picture"
                  onClick={() => step(-1)}
                >
                  <CaretLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next picture"
                  onClick={() => step(1)}
                >
                  <CaretRightIcon />
                </Button>
              </>
            ) : null}
          </div>
          <div className="grid min-h-0 place-items-center bg-muted">
            <img
              src={picture.src}
              alt={picture.name}
              className="max-h-[calc(100dvh-6.5rem)] max-w-full object-contain"
            />
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}
