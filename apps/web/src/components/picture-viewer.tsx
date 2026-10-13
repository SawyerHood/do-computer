import { CaretLeftIcon, CaretRightIcon, DownloadSimpleIcon } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

export type ViewedPicture = { id: string; name: string; src: string }

/**
 * One of several pictures, large. With several, the arrows go from one to the next. `download`
 * offers the picture as a file, where it is one that can be taken.
 */
export function PictureViewer({
  pictures,
  id,
  open,
  download = false,
  onShow,
  onClose,
}: {
  pictures: ViewedPicture[]
  id: string | undefined
  open: boolean
  download?: boolean
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
            {download ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Download"
                title="Download"
                render={
                  // biome-ignore lint/a11y/useAnchorContent: the button gives it its content
                  <a href={picture.src} download={picture.name} target="_blank" rel="noreferrer" />
                }
              >
                <DownloadSimpleIcon />
              </Button>
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
