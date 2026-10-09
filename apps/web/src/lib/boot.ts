const BOOT_TRIES_KEY = "dc-boot-tries"

/**
 * Runs before anything else in the page. The frame of the app is in the page as it is sent, and
 * stays until the app's own code takes over. Code that never arrives, as when the network
 * changes under a laptop that has just woken or the server is replaced between the page and its
 * scripts, would leave the frame up for good. The page is loaded again instead, a few times and
 * further apart each time, and after that it says so and offers to. Only the app's own scripts
 * count: one that something in the browser blocked is not the app's and is not waited for.
 * Keep the key in step with `started`.
 */
export const BOOT_GUARD_SCRIPT = `(function(){var k="${BOOT_TRIES_KEY}",waits=[300,3000,10000];function tell(){if(document.getElementById(k))return;var b=document.createElement("button");b.id=k;b.type="button";b.className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 border bg-background px-3 py-2 text-sm text-foreground";b.textContent="Do Computer did not load. Try again";b.onclick=function(){try{sessionStorage.removeItem(k)}catch(e){}location.reload()};document.body.appendChild(b)}function again(){try{var s=sessionStorage,n=+s.getItem(k)||0;if(n<waits.length){s.setItem(k,n+1);setTimeout(function(){location.reload()},waits[n]);return}}catch(e){}tell()}addEventListener("error",function(e){var t=e.target;if(t&&t.tagName==="SCRIPT"&&t.src&&t.src.indexOf(location.origin+"/assets/")===0)again()},true)})()`

/** The app's code is here and running: the next time it does not arrive is counted from nothing. */
export function started(): void {
  try {
    sessionStorage.removeItem(BOOT_TRIES_KEY)
  } catch {
    // Storage can be unavailable; the page then says it did not load without trying again first.
  }
}
