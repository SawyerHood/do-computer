------------------------- MODULE ReplySettlement -------------------------
EXTENDS FiniteSets
CONSTANTS Requests, Kinds, Strict
VARIABLES expected, waiting, armed
vars == <<expected, waiting, armed>>
Init ==
  /\ expected \in [Requests -> Kinds]
  /\ waiting = Requests /\ armed = Requests
Receive(i, kind) ==
  /\ i \in armed /\ kind \in Kinds
  /\ armed' = IF Strict /\ kind # expected[i] THEN armed ELSE armed \ {i}
  /\ waiting' = IF kind = expected[i] THEN waiting \ {i} ELSE waiting
  /\ UNCHANGED expected
Timeout(i) ==
  /\ i \in armed
  /\ armed' = armed \ {i} /\ waiting' = waiting \ {i}
  /\ UNCHANGED expected
Next == \E i \in Requests: Timeout(i) \/ (\E kind \in Kinds: Receive(i, kind))
Spec == Init /\ [][Next]_vars /\ (\A i \in Requests: WF_vars(Timeout(i)))
TypeOK == expected \in [Requests -> Kinds] /\ waiting \subseteq Requests /\ armed \subseteq Requests
EveryWaitingHasTimer == waiting \subseteq armed
CallsSettle == <>(waiting = {})
PreservesTimers == []EveryWaitingHasTimer
=============================================================================
