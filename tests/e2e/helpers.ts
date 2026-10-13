import { test as base, expect, type Page } from '@playwright/test';
export const KEY='ledgerly-state-v1';
export const TODAY=new Date('2026-10-08T09:00:00Z');
export function seed() {
 return {accounts:[{id:'cash',name:'Cash',type:'cash',openingBalance:1200,color:'#22c55e'},{id:'bank',name:'Bank',type:'bank',openingBalance:3400,color:'#3b82f6'},{id:'card',name:'Credit Card',type:'credit',openingBalance:0,color:'#f59e0b'}],categories:[{id:'food',name:'Food',parentId:null},{id:'groceries',name:'Groceries',parentId:'food'},{id:'housing',name:'Housing',parentId:null},{id:'salary',name:'Salary',parentId:null}],transactions:[],budgets:[],recurring:[],theme:'light',currency:'USD',ui:{route:'/dashboard',filters:{startDate:'',endDate:'',accountId:'',categoryId:'',type:'',minAmount:'',maxAmount:'',search:''},sort:[{key:'date',direction:'desc'}],page:1,pageSize:10,selectedTransactionIds:[]}} as any;
}
export function txn(id:string, overrides:any={}) {return {id,accountId:'cash',type:'expense',amount:10,date:'2026-10-08',categoryId:'food',payee:id,notes:'',tags:[],transferGroupId:null,transferSide:null,...overrides};}
export function rule(overrides:any={}) {return {id:'rule',title:'Rent',type:'expense',amount:10,accountId:'cash',categoryId:'food',interval:'daily',customDays:1,nextRunDate:'2026-10-05',processedDates:[],anchorDay:5,...overrides};}
export function transfer(amount=100) {return [txn('source',{type:'transfer',amount,categoryId:null,transferGroupId:'pair',transferSide:'source'}),txn('destination',{type:'transfer',amount,accountId:'bank',categoryId:null,transferGroupId:'pair',transferSide:'destination'})];}
export const test=base.extend<{errors:string[]}>({errors:[async({page},use)=>{const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error') errors.push(m.text());});page.on('dialog',d=>d.accept());await use(errors);expect(errors,'no browser or console errors').toEqual([]);},{auto:true}]});
export {expect};
export async function boot(page:Page, data:any=seed(), route='dashboard') {
 await page.clock.install({time:TODAY});
 // Once per tab: reload must exercise real persistence rather than reseeding.
 await page.addInitScript(({data,key})=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem(key,JSON.stringify(data));sessionStorage.setItem('seeded','yes');}},{data,key:KEY});
 await page.goto('/#/'+route);await expect(page.locator('#top-nav a')).toHaveCount(7);
 // A screenshot forces a real WebKit paint; the installed clock mocks rAF.
 // This settles inherited theme colors before accessibility reads styles.
 if(page.context().browser()?.browserType().name()==='webkit')await page.screenshot({animations:'disabled'});
}
export async function state(page:Page) {return page.evaluate(async key=>navigator.locks ? navigator.locks.request('ledgerly-state-write',()=>JSON.parse(localStorage.getItem(key)!)) : JSON.parse(localStorage.getItem(key)!),KEY);}
export async function route(page:Page, name:string) {await page.locator(`a[data-route="/${name}"]`).click();await expect(page.locator('.view.active')).toHaveAttribute('data-route',name);}
export async function fill(page:Page, id:string, values:Record<string,any>) {for(const [key,value]of Object.entries(values)){const field=page.locator(`#${id} [name="${key}"]`);if(await field.evaluate(el=>el.tagName==='SELECT'))await field.selectOption(String(value));else await field.fill(String(value));}}
export async function submit(page:Page,id:string) {
 await page.locator(`#${id} button[type=submit]`).click();
 // Wait for queued persistence and rendering before filling the next form.
 await page.evaluate(async()=>{if(navigator.locks)await navigator.locks.request('ledgerly-state-write',()=>{});});
}
export async function add(page:Page, values:any={}) {const fields={type:'expense',date:'2026-10-08',accountId:'cash',categoryId:'food',amount:10,payee:'New',...values};if(fields.type==='transfer')delete fields.categoryId;await fill(page,'transaction-form',fields);await submit(page,'transaction-form');}
export async function invariant(page:Page){const s=await state(page);const groups=new Map<string,any[]>();for(const t of s.transactions)if(t.type==='transfer')groups.set(t.transferGroupId,[...(groups.get(t.transferGroupId)||[]),t]);for(const pair of groups.values()){expect(pair).toHaveLength(2);expect(new Set(pair.map(t=>t.transferSide)).size).toBe(2);expect(pair[0].amount).toBe(pair[1].amount);expect(pair[0].date).toBe(pair[1].date);expect(pair[0].accountId).not.toBe(pair[1].accountId);}const net=s.accounts.reduce((n:any,a:any)=>n+Math.round(a.openingBalance*100),0)+s.transactions.reduce((n:any,t:any)=>n+(t.type==='income'?1:t.type==='expense'?-1:0)*Math.round(t.amount*100),0);await route(page,'dashboard');await expect(page.locator('#dashboard-stats .stat-value').first()).toHaveText(new Intl.NumberFormat(s.currency==='INR'?'en-IN':'en-US',{style:'currency',currency:s.currency}).format(net/100));}
export async function csv(page:Page,text:string){await page.setInputFiles('#import-csv-input',{name:'rows.csv',mimeType:'text/csv',buffer:Buffer.from(text)});await expect(page.locator('#mapping-modal')).toBeVisible();}
export async function tabTo(page:Page, selector:string) {
 const target=page.locator(selector);await expect(target).toBeVisible();await expect(target).toBeEnabled();
 // macOS WebKit uses Option+Tab to include links and form controls.
 const allControls=process.platform==='darwin'&&page.context().browser()?.browserType().name()==='webkit';
 for(let i=0;i<150;i++){
  const direction=await target.evaluate(el=>el===document.activeElement?'done':el.compareDocumentPosition(document.activeElement!)&Node.DOCUMENT_POSITION_FOLLOWING?'Shift+Tab':'Tab');
  if(direction==='done')return;
  await page.keyboard.press(allControls?'Alt+'+direction:direction);
 }
 throw new Error('Keyboard cannot reach '+selector);
}
