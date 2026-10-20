------------------------- MODULE ExecLifecycle -------------------------
EXTENDS Naturals, FiniteSets
CONSTANTS Requests, Limit, StartPhase, ClientBound, ServerBound,
          RememberCancel, KillLate
VARIABLES phase, caller, aborted, age, shellAge, busy, child,
          pendingAlloc, eof, bootReady
vars == <<phase, caller, aborted, age, shellAge, busy, child,
          pendingAlloc, eof, bootReady>>
Init ==
  /\ phase = [i \in Requests |-> StartPhase]
  /\ caller = [i \in Requests |-> "waiting"]
  /\ aborted = [i \in Requests |-> FALSE]
  /\ age = [i \in Requests |-> 0]
  /\ shellAge = [i \in Requests |-> 0]
  /\ busy = IF StartPhase = "boot" THEN {} ELSE Requests
  /\ child = [i \in Requests |-> IF StartPhase = "stream" THEN "running" ELSE "absent"]
  /\ pendingAlloc = IF StartPhase = "spawn" THEN Requests ELSE {}
  /\ eof = {}
  /\ bootReady = (StartPhase # "boot")
BootCompletes ==
  /\ ~bootReady
  /\ bootReady' = TRUE
  /\ UNCHANGED <<phase, caller, aborted, age, shellAge, busy, child, pendingAlloc, eof>>
BeginSpawn(i) ==
  /\ phase[i] = "boot" /\ bootReady
  /\ phase' = [phase EXCEPT ![i] = "spawn"]
  /\ busy' = busy \cup {i}
  /\ pendingAlloc' = pendingAlloc \cup {i}
  /\ UNCHANGED <<caller, aborted, age, shellAge, child, eof, bootReady>>
KernelReturns(i) ==
  /\ i \in pendingAlloc
  /\ pendingAlloc' = pendingAlloc \ {i}
  /\ child' = [child EXCEPT ![i] = IF KillLate /\ phase[i] = "finished"
                                      THEN "exited" ELSE "running"]
  /\ phase' = [phase EXCEPT ![i] = IF @ = "spawn" THEN "stream" ELSE @]
  /\ UNCHANGED <<caller, aborted, age, shellAge, busy, eof, bootReady>>
Abort(i) ==
  /\ ~aborted[i]
  /\ aborted' = [aborted EXCEPT ![i] = TRUE]
  /\ caller' = [caller EXCEPT ![i] = IF ClientBound THEN "settled" ELSE @]
  /\ phase' = [phase EXCEPT ![i] = IF RememberCancel THEN "finished" ELSE @]
  /\ busy' = IF RememberCancel THEN busy \ {i} ELSE busy
  /\ child' = [child EXCEPT ![i] = IF @ = "running" THEN "exited" ELSE @]
  /\ UNCHANGED <<age, shellAge, pendingAlloc, eof, bootReady>>
Tick ==
  /\ age' = [i \in Requests |-> IF age[i] < Limit /\ (phase[i] # "finished" \/ caller[i] = "waiting")
                                    THEN age[i] + 1 ELSE age[i]]
  /\ shellAge' = [i \in Requests |-> IF shellAge[i] < Limit /\ child[i] = "running"
                                         THEN shellAge[i] + 1 ELSE shellAge[i]]
  /\ <<age', shellAge'>> # <<age, shellAge>>
  /\ UNCHANGED <<phase, caller, aborted, busy, child, pendingAlloc, eof, bootReady>>
HostDeadline(i) ==
  /\ ClientBound /\ age[i] = Limit /\ caller[i] = "waiting"
  /\ caller' = [caller EXCEPT ![i] = "settled"]
  /\ UNCHANGED <<phase, aborted, age, shellAge, busy, child, pendingAlloc, eof, bootReady>>
ServerDeadline(i) ==
  /\ ServerBound /\ age[i] = Limit /\ phase[i] # "finished"
  /\ phase' = [phase EXCEPT ![i] = "finished"]
  /\ busy' = busy \ {i}
  /\ child' = [child EXCEPT ![i] = IF @ = "running" THEN "exited" ELSE @]
  /\ UNCHANGED <<caller, aborted, age, shellAge, pendingAlloc, eof, bootReady>>
ShellLimit(i) ==
  /\ shellAge[i] = Limit /\ child[i] = "running"
  /\ child' = [child EXCEPT ![i] = "exited"]
  /\ UNCHANGED <<phase, caller, aborted, age, shellAge, busy, pendingAlloc, eof, bootReady>>
NaturalExit(i) ==
  /\ child[i] = "running"
  /\ child' = [child EXCEPT ![i] = "exited"]
  /\ UNCHANGED <<phase, caller, aborted, age, shellAge, busy, pendingAlloc, eof, bootReady>>
PipeCloses(i) ==
  /\ phase[i] = "stream" /\ child[i] = "exited" /\ i \notin eof
  /\ eof' = eof \cup {i}
  /\ UNCHANGED <<phase, caller, aborted, age, shellAge, busy, child, pendingAlloc, bootReady>>
Finalize(i) ==
  /\ phase[i] = "stream" /\ child[i] = "exited" /\ i \in eof
  /\ phase' = [phase EXCEPT ![i] = "finished"]
  /\ caller' = [caller EXCEPT ![i] = "settled"]
  /\ busy' = busy \ {i}
  /\ UNCHANGED <<aborted, age, shellAge, child, pendingAlloc, eof, bootReady>>
Next ==
  \/ BootCompletes \/ Tick
  \/ \E i \in Requests: BeginSpawn(i) \/ KernelReturns(i) \/ Abort(i) \/
       HostDeadline(i) \/ ServerDeadline(i) \/ ShellLimit(i) \/
       NaturalExit(i) \/ PipeCloses(i) \/ Finalize(i)
Spec ==
  /\ Init /\ [][Next]_vars /\ WF_vars(Tick)
  /\ \A i \in Requests: WF_vars(HostDeadline(i)) /\ WF_vars(ServerDeadline(i)) /\
       WF_vars(ShellLimit(i)) /\ WF_vars(Finalize(i)) /\ WF_vars(BeginSpawn(i))
TypeOK ==
  /\ phase \in [Requests -> {"boot", "spawn", "stream", "finished"}]
  /\ caller \in [Requests -> {"waiting", "settled"}]
  /\ aborted \in [Requests -> BOOLEAN]
  /\ age \in [Requests -> 0..Limit] /\ shellAge \in [Requests -> 0..Limit]
  /\ busy \subseteq Requests /\ pendingAlloc \subseteq Requests /\ eof \subseteq Requests
  /\ child \in [Requests -> {"absent", "running", "exited"}] /\ bootReady \in BOOLEAN
CallsSettle == \A i \in Requests: <>(caller[i] = "settled")
BusyDrains == \A i \in Requests: [](i \in busy => <>(i \notin busy))
NoPostAbortSpawn == \A i \in Requests: aborted[i] => child[i] # "running"
CancellationSafety == []NoPostAbortSpawn
=============================================================================
