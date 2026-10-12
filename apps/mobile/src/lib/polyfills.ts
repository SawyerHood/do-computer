import * as ExpoCrypto from "expo-crypto"

// A phone's JavaScript has no `crypto`, which the shared code makes its ids with. This gives it
// the two things that code asks of one, from the system's own random numbers. Imported first,
// before anything that might make an id.
const scope = globalThis as { crypto?: Partial<Crypto> }
if (scope.crypto?.getRandomValues === undefined) {
  scope.crypto = {
    ...scope.crypto,
    getRandomValues: ExpoCrypto.getRandomValues as Crypto["getRandomValues"],
    randomUUID: ExpoCrypto.randomUUID as Crypto["randomUUID"],
  }
}
