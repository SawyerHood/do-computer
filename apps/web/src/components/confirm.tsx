import { type ReactNode, useCallback, useRef, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

type Question = {
  title: string
  /** What agreeing leads to, where the title does not say it all. */
  description?: string
  /** What the button that agrees says. */
  action: string
  /** It cannot be taken back, and the button says so by its color. */
  destructive?: boolean
}

/**
 * Asking before something is done that is hard to undo. Gives a function that asks and resolves
 * to whether they agreed, and the dialog it asks in, which goes anywhere in what is rendered.
 */
export function useConfirm(): [(question: Question) => Promise<boolean>, ReactNode] {
  const [question, setQuestion] = useState<Question>()
  const [open, setOpen] = useState(false)
  const answer = useRef<(agreed: boolean) => void>(undefined)

  const ask = useCallback((next: Question) => {
    // Asked again before an answer: the first is taken as a no.
    answer.current?.(false)
    setQuestion(next)
    setOpen(true)
    return new Promise<boolean>((resolve) => {
      answer.current = resolve
    })
  }, [])
  const settle = (agreed: boolean) => {
    answer.current?.(agreed)
    answer.current = undefined
    setOpen(false)
  }

  const dialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false)
      }}
    >
      {/* The question is kept once answered, so the words stay while the dialog fades out. */}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{question?.title}</AlertDialogTitle>
          {question?.description === undefined ? null : (
            <AlertDialogDescription>{question.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={question?.destructive ? "destructive" : "default"}
            onClick={() => settle(true)}
          >
            {question?.action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
  return [ask, dialog]
}
