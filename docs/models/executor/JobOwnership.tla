--------------------------- MODULE JobOwnership ---------------------------
EXTENDS Naturals
CONSTANTS Hardened, Limit
VARIABLES phase, running, durable, pendingStart, stopPending, stopDone,
          tombstone, callerDone, aborted, daemonTimer, age
vars == <<phase, running, durable, pendingStart, stopPending, stopDone,
          tombstone, callerDone, aborted, daemonTimer, age>>
Init ==
  /\ phase = "requested" /\ running = FALSE /\ durable = Hardened
  /\ pendingStart = TRUE /\ stopPending = FALSE /\ stopDone = FALSE
  /\ tombstone = FALSE /\ callerDone = FALSE /\ aborted = FALSE
  /\ daemonTimer = FALSE /\ age = 0
DeliverStart ==
  /\ pendingStart
  /\ pendingStart' = FALSE
  /\ running' = ~(Hardened /\ tombstone)
  /\ daemonTimer' = running'
  /\ phase' = IF callerDone THEN phase ELSE "following"
  /\ UNCHANGED <<durable, stopPending, stopDone, tombstone, callerDone, aborted, age>>
Abort ==
  /\ ~aborted /\ ~callerDone
  /\ aborted' = TRUE
  /\ stopPending' = (phase # "handoff")
  /\ callerDone' = (phase = "handoff")
  /\ UNCHANGED <<phase, running, durable, pendingStart, stopDone, tombstone, daemonTimer, age>>
DeliverStop ==
  /\ stopPending
  /\ stopPending' = FALSE /\ stopDone' = TRUE /\ running' = FALSE
  /\ tombstone' = Hardened \/ tombstone
  /\ UNCHANGED <<phase, durable, pendingStart, callerDone, aborted, daemonTimer, age>>
ReturnAborted ==
  /\ aborted /\ stopDone /\ ~callerDone
  /\ callerDone' = TRUE
  /\ UNCHANGED <<phase, running, durable, pendingStart, stopPending, stopDone, tombstone,
                 aborted, daemonTimer, age>>
BeginHandoff ==
  /\ phase = "following" /\ ~aborted /\ ~callerDone /\ running
  /\ phase' = "handoff"
  /\ UNCHANGED <<running, durable, pendingStart, stopPending, stopDone, tombstone,
                 callerDone, aborted, daemonTimer, age>>
Commit ==
  /\ phase = "handoff" /\ ~callerDone /\ ~aborted
  /\ durable' = TRUE /\ callerDone' = TRUE
  /\ UNCHANGED <<phase, running, pendingStart, stopPending, stopDone, tombstone,
                 aborted, daemonTimer, age>>
CrashAgent ==
  /\ ~callerDone
  /\ callerDone' = TRUE
  /\ UNCHANGED <<phase, running, durable, pendingStart, stopPending, stopDone, tombstone,
                 aborted, daemonTimer, age>>
RestartDaemon ==
  /\ daemonTimer
  /\ daemonTimer' = FALSE
  /\ UNCHANGED <<phase, running, durable, pendingStart, stopPending, stopDone, tombstone,
                 callerDone, aborted, age>>
Tick ==
  /\ running /\ age < Limit
  /\ age' = age + 1
  /\ UNCHANGED <<phase, running, durable, pendingStart, stopPending, stopDone, tombstone,
                 callerDone, aborted, daemonTimer>>
Expire ==
  /\ running /\ age = Limit /\ (daemonTimer \/ Hardened)
  /\ running' = FALSE
  /\ UNCHANGED <<phase, durable, pendingStart, stopPending, stopDone, tombstone,
                 callerDone, aborted, daemonTimer, age>>
NaturalExit ==
  /\ running /\ running' = FALSE
  /\ UNCHANGED <<phase, durable, pendingStart, stopPending, stopDone, tombstone,
                 callerDone, aborted, daemonTimer, age>>
Next == DeliverStart \/ Abort \/ DeliverStop \/ ReturnAborted \/ BeginHandoff \/ Commit \/
        CrashAgent \/ RestartDaemon \/ Tick \/ Expire \/ NaturalExit
Spec == Init /\ [][Next]_vars /\ WF_vars(Tick) /\ WF_vars(Expire)
TypeOK ==
  /\ phase \in {"requested", "following", "handoff"}
  /\ <<running, durable, pendingStart, stopPending, stopDone, tombstone,
        callerDone, aborted, daemonTimer>> \in BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN \X BOOLEAN
  /\ age \in 0..Limit
NoUnownedProcess == ~running \/ durable \/ ~callerDone
NoStartAfterAcknowledgedStop == ~(running /\ stopDone)
ProcessEventuallyStops == [](running => <>~running)
Ownership == []NoUnownedProcess
CancellationOrder == []NoStartAfterAcknowledgedStop
=============================================================================
