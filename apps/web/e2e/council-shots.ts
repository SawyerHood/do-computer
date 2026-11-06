// Fixed council views. Real production UI; only the chat socket and desktop preload are mocked.
// Run after build:node, scripts/council/serve.sh, and desktop-build.mjs.
import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ChatState, ChatMessage } from '@do-computer/protocol'
const OUT=resolve(process.env.COUNCIL_OUT ?? '../../.council/shots')
const ROOT=resolve('../..')
const at=Date.UTC(2026,10,6,10,30)
const msg=(id:string,role:ChatMessage['role'],text:string):ChatMessage=>({id,role,parts:[{type:'text',text}],status:'done',createdAt:at, ...(role==='assistant'?{sent:'sent',done:true}: {})})
const answer='I found three good options for the team offsite.\n\n### A little room to think\n\n| Place | Travel | Per person |\n| --- | --- | --- |\n| **The River House** | 45 min | $180 |\n| Cedar Lodge | 1 hr | $210 |\n| Coast Studio | 35 min | $165 |\n\nThe River House is my pick: a quiet workspace, lunch included, and a trail nearby. I’ve saved the shortlist for you.\n\nWant me to check availability for Friday?'
const conversation:ChatState={messages:[msg('u1','user','Find a place for our team offsite. Eight people, near the city, under $250 each.'),msg('a1','assistant',answer)],busy:false,queued:[],usage:{inputTokens:1200,outputTokens:240,cost:0.012}}
const running:ChatState={...conversation,busy:true,messages:[msg('u2','user','Check Friday availability and draft a plan for the River House.'),{id:'a2',role:'assistant',status:'streaming',createdAt:at,parts:[{type:'thinking',text:'I’ll compare their available rooms, confirm the group rate, and put together a short plan.'},{type:'tool',toolCallId:'web1',name:'web_search',args:{query:'The River House group booking Friday'},status:'done',output:'Private room available Friday, 9 am–5 pm. Lunch included. $180 per person.'},{type:'tool',toolCallId:'web2',name:'browse',args:{url:'https://example.com/river-house'},status:'running',output:'Checking the booking options…'}]}]}
async function shoot(page:Page,name:string){
 for(const colorScheme of ['light','dark'] as const){
  await page.emulateMedia({colorScheme,reducedMotion:'reduce'})
  await page.evaluate(scheme=>document.documentElement.classList.toggle('dark',scheme==='dark'),colorScheme)
  await page.mouse.move(2,2)
  await page.waitForTimeout(800)
  await page.screenshot({path:resolve(OUT,`${name}-${colorScheme}.png`),animations:'disabled'})
 }
}
test('the fixed council views',async({page,baseURL})=>{
 mkdirSync(OUT,{recursive:true})
 await page.addInitScript(()=>{localStorage.setItem('dc-chat-list','open');localStorage.setItem('dc-agent-panel','closed')})
 const account={name:'Ada',email:'owner@example.com',password:'correct horse battery'}
 const signup=await page.request.post('/api/auth/sign-up/email',{data:account})
 if(!signup.ok()) expect((await page.request.post('/api/auth/sign-in/email',{data:account})).ok()).toBe(true)
 let agents=await (await page.request.get('/api/agents')).json()
 if(!agents.agents?.length){
  await page.request.post('/api/agents')
  agents=await (await page.request.get('/api/agents')).json()
 }
 // The persistent local data directory keeps IDs/creature seeds identical from round to round.
 const agent=agents.agents[0]
 await page.request.patch(`/api/agents/${agent.id}`,{data:{name:'Juniper',hatched:true}})
 let state:ChatState={messages:[],busy:false,queued:[],usage:{inputTokens:0,outputTokens:0,cost:0}}
 await page.routeWebSocket(/\/api\/agents\/[^/]+\/socket$/,socket=>{
  const server=socket.connectToServer()
  server.onMessage(data=>{
   let value
   try{value=JSON.parse(String(data))}catch{socket.send(data);return}
   if(value.type==='chat'&&value.event.type==='snapshot') value.event.state=state
   socket.send(JSON.stringify(value))
  })
 })
 await page.goto(`/a/${agent.id}`)
 await expect(page.getByRole('textbox',{name:'Message'})).toBeVisible()
 const chat=page.url()
 await shoot(page,'01-home')
 state=conversation
 await page.reload()
 await expect(page.getByRole('log').getByText('A little room to think')).toBeVisible()
 await shoot(page,'02-conversation')
 state=running
 await page.reload()
 await expect(page.getByRole('button',{name:/stop/i}).first()).toBeVisible()
 await shoot(page,'03-running')
 state=conversation
 await page.goto(`${chat}?settings=identity`)
 await expect(page.getByRole('dialog')).toBeVisible()
 await shoot(page,'04-settings')
 const save=page.getByRole('button',{name:'Save changes'})
 const before=await save.boundingBox();const bounds=await page.getByRole('dialog').boundingBox()
 expect(before!.y+before!.height).toBeLessThanOrEqual(bounds!.y+bounds!.height)
 await page.locator('[data-settings-body]').evaluate(node=>{node.scrollTop=node.scrollHeight})
 expect((await save.boundingBox())!.y).toBe(before!.y)
 await page.goto(`/a/${agent.id}/connectors`)
 await expect(page.getByRole('heading',{name:'Connectors',exact:true})).toBeVisible()
 await shoot(page,'05-connectors')
 await page.setViewportSize({width:390,height:844})
 await page.goto(chat)
 await expect(page.getByRole('log').getByText('A little room to think')).toBeVisible()
 await shoot(page,'06-phone-conversation')
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 // The Electron-specific settings, rendered from their production HTML/CSS and bundled scripts.
 await page.setViewportSize({width:760,height:1000})
 const desktopState={server:baseURL,local:true,welcomed:true,sharing:{state:'connected'},headline:'Your Doods can use this computer',readOnly:false,screen:true,browser:true,canOpenAtLogin:true,openAtLogin:true,platform:'linux',version:'0.1.0',update:{state:'current'},log:['[2026-11-06T10:30:00.000Z] Connected to Do Computer','[2026-11-06T10:30:01.000Z] Ready for your Doods'],tailnet:{status:{state:'ready',name:'studio.example.ts.net'},on:false,busy:false}}
 await page.addInitScript(state=>{
  (window as unknown as {desktop: unknown}).desktop={state:async()=>state,watch:()=>{},share:async()=>{},allow:async()=>{},setOpenAtLogin:async()=>{},update:async()=>{},changeServer:async()=>{},deviceLink:async()=>({error:'No device requested'}),lookForTailnet:async()=>{},setTailnet:async()=>{},open:async()=>{},copy:async()=>{},confirm:async()=>{},connect:async()=>undefined,retry:async()=>{},devices:async()=>{},permit:async()=>{}}
 },desktopState)
 await page.route('**/__council-desktop/*',async route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop()!
  if(!['computer.html','devices.html','computer.js','devices.js','pages.css','geist-latin.woff2'].includes(name)) return route.abort()
  await route.fulfill({body:readFileSync(resolve(ROOT,'.council/desktop',name)),contentType:name.endsWith('.woff2')?'font/woff2':name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html'})
 })
 await page.goto('/__council-desktop/computer.html')
 await expect(page.getByRole('status')).toHaveText(desktopState.headline)
 await shoot(page,'07-desktop-computer')
 expect(await page.evaluate(async()=>{const fonts=await document.fonts.load('14px Geist');return fonts.length>0&&fonts.every(font=>font.status==='loaded')})).toBe(true)
 await page.goto('/__council-desktop/devices.html')
 await expect(page.getByRole('status')).toContainText('Only this computer')
 await shoot(page,'08-desktop-devices')
})
