const state = { markets: [], scored: [], marketCatalog: [], marketCatalogCoins: new Map(), marketCatalogTotal: 0, marketCatalogMatched: 0, marketCatalogLoading: true, marketCatalogLoaded: false, marketCatalogReliable: false, marketCatalogSource: "loading", marketMovers: {gainers:[],losers:[]}, marketIntelligence: null, portfolio: null, plan: null, journal: [], transactions: [], trending: [], news: [], translations: {}, newsFilter: "ALL", currentPage: "overview", intelligenceTab: "temperature", community: {profiles:[],messages:[],posts:[],following:[],followedStrategies:[],reactedPosts:[],activeNow:0}, communityTab: "live", demo: false, marketStale: false, marketAsOf: 0, marketSource: "unknown", transactionTotal: 0 };
const $ = (id) => document.getElementById(id);
const clamp = (x, lo=0, hi=100) => Math.min(hi, Math.max(lo, x));
const uiLocale = () => window.CryptoRadarI18n?.locale() || "it-IT";
const tr = value => window.CryptoRadarI18n?.translate?.(value) || value;
const fmtEur = (n, compact=false) => new Intl.NumberFormat(uiLocale(), {style:"currency",currency:"EUR",notation:compact?"compact":"standard",maximumFractionDigits:n<1?5:2}).format(n||0);
const fmtPct = (n) => n == null ? "—" : `${n>=0?"+":""}${n.toFixed(1)}%`;
const num = (x) => Number.isFinite(Number(x)) ? Number(x) : 0;
const pctClass = (n) => n > .15 ? "positive" : n < -.15 ? "negative" : "neutral";
const change = (coin, period) => num(coin[`price_change_percentage_${period}_in_currency`]);
const esc = (value) => String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

const stableSymbols = new Set(["usdt","usdc","dai","fdusd","usde","usds","tusd","pyusd","usdd","frax","gusd","eurc","euri","rlusd"]);
const excludedName = /(wrapped|bridged|staked|restaked|liquid staking)/i;
function stableLike(c){
  const symbol=c.symbol.toLowerCase();
  return stableSymbols.has(symbol) || /^(usd|eur)|(?:usd|eur)$/.test(symbol) || /\b(usd|dollar|stablecoin|euro)\b/i.test(c.name);
}

function volatility(coin){
  const prices = coin.sparkline_in_7d?.price || [];
  if(prices.length < 3) return 12;
  const returns = prices.slice(1).map((p,i)=>Math.log(p/prices[i])).filter(Number.isFinite);
  const mean = returns.reduce((a,b)=>a+b,0)/returns.length;
  const variance = returns.reduce((a,b)=>a+(b-mean)**2,0)/returns.length;
  return Math.sqrt(variance)*Math.sqrt(24*365)*100;
}

function scoreCoin(c){
  const d7=change(c,"7d"), d30=change(c,"30d"), d1=change(c,"24h");
  const momentum = clamp(50+d7*1.2)*.4 + clamp(50+d30*.75)*.6 - (Math.abs(d1)>20?10:0);
  const volumeRatio = c.market_cap ? c.total_volume/c.market_cap : 0;
  const liquidity = clamp((Math.log10(Math.max(volumeRatio,.001))+3)*40)*.65 + clamp((Math.log10(Math.max(c.market_cap,1))-7)*22)*.35;
  const dilutionRatio = c.fully_diluted_valuation && c.market_cap ? c.fully_diluted_valuation/c.market_cap : 1.15;
  const tokenomics = clamp(110-(dilutionRatio-1)*65);
  const vol = volatility(c);
  const rankSafety = clamp(105-num(c.market_cap_rank)*.55);
  const volSafety = clamp(110-vol*.7);
  const riskScore = rankSafety*.45+volSafety*.55;
  const score = clamp(momentum*.30+liquidity*.25+tokenomics*.20+riskScore*.25);
  const risk = vol<65 && num(c.market_cap_rank)<=50 ? "basso" : vol<105 && num(c.market_cap_rank)<=140 ? "medio" : "alto";
  return {...c,_score:Math.round(score),_momentum:Math.round(momentum),_liquidity:Math.round(liquidity),_tokenomics:Math.round(tokenomics),_riskScore:Math.round(riskScore),_vol:vol,_risk:risk,_dilution:dilutionRatio};
}

function eligible(c){
  return !stableLike(c) && !excludedName.test(c.name) && c.market_cap_rank && c.market_cap_rank<=200 && c.market_cap>1e8 && c.total_volume>5e6 && c._dilution<=2.5;
}

async function api(path, options){
  const response=await fetch(path,options);
  const data=await response.json();
  if(!response.ok) throw new Error(data.error||"Richiesta non riuscita");
  return data;
}

async function loadAll(showFlash=false){
  try{
    $("notice").classList.add("hidden");
    if(showFlash) $("refreshBtn").classList.add("flash");
    const [marketResponse,moversResponse,portfolio,plan,journalResponse,trendResponse,newsResponse,config]=await Promise.all([
      api("/api/markets"), api("/api/market-movers").catch(error=>({source:"CoinMarketCap",gainers:[],losers:[],error:error.message})), api("/api/portfolio"), api("/api/plan"), api("/api/journal").catch(()=>({entries:[]})),
      api("/api/trending").catch(()=>({coins:[]})),
      api("/api/news").catch(()=>({articles:[]})), api("/api/config").catch(()=>({demo:false}))
    ]);
    state.demo=Boolean(config.demo);
    state.markets=marketResponse.data;
    state.scored=state.markets.map(scoreCoin).sort((a,b)=>b._score-a._score);
    state.marketMovers=moversResponse;
    state.portfolio=state.demo?localData("cryptoRadarPortfolio",{currency:"eur",holdings:[]}):portfolio;
    state.plan=state.demo?localData("cryptoRadarPlan",plan):plan;
    state.journal=state.demo?localData("cryptoRadarDecisionJournal",[]):journalResponse.entries||[];
    state.trending=(trendResponse.coins||[]).map(x=>x.item).slice(0,10);
    state.news=newsResponse.articles||[];
    state.marketStale=Boolean(marketResponse.stale);
    state.marketAsOf=num(marketResponse.asOf);state.marketSource=marketResponse.source||"unknown";
    $("lastUpdate").textContent=state.marketStale?`Dati di riserva · ${new Date(marketResponse.asOf*1000).toLocaleDateString("it-IT")}`:`Aggiornato ${new Date(marketResponse.asOf*1000).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}`;
    syncPlanTargets();renderOverview(); renderScreener(); renderPortfolio(); renderPlan(); renderDecisionLab(); renderDiscovery(); renderDemoMode(); loadImportHistory(); renderOperations(); renderCopilot(); renderAdvanced(); renderIntelligence(); renderOnboarding(); renderDataQuality(); checkCooldown();window.CryptoRadarI18n?.translateDocument();
    loadMarketCatalog();
    loadMarketIntelligence();
    loadTranslations();
  }catch(error){ showError(error.message); }
  finally{$("refreshBtn").classList.remove("flash")}
}

function renderDemoMode(){
  $("demoBanner").classList.toggle("hidden",!state.demo);
  ["savePortfolio","savePlan","saveDecision"].forEach(id=>{const button=$(id);if(!button)return;button.disabled=false;if(state.demo)button.title="Salvataggio privato in questo browser"});
}

function showError(message){$("notice").textContent=message;$("notice").classList.remove("hidden")}
function coinById(id){return state.scored.find(c=>c.id===id)||state.marketCatalogCoins.get(id)}
function pinnedCoinById(id){return coinById(id)||state.marketCatalogCoins.get(id)}
function canonicalCoinId(id){return coinById(id)?.id||id}
function catalogRank(coin){return num(coin?.cmcRank)||num(coin?.market_cap_rank)||999999}
function sameCoinIdentity(firstId,secondId){
  if(firstId===secondId)return true;
  const first=coinById(firstId),second=coinById(secondId);
  return Boolean(first&&second&&(first.id===second.id||(first.cmcId&&second.cmcId&&first.cmcId===second.cmcId)));
}
function pinnedIds(){
  try{const value=JSON.parse(localStorage.getItem("cryptoRadarPinnedCoins")||"[]");return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==="string"))].slice(0,5):[]}
  catch{return []}
}
function savePinnedIds(ids){localStorage.setItem("cryptoRadarPinnedCoins",JSON.stringify([...new Set(ids)].slice(0,5)))}
function pinnedSortMode(){const value=localStorage.getItem("cryptoRadarPinnedSort");return value==="name"?"name":"rank"}
function catalogPersistedCmcIds(){
  const paperIds=Object.keys(localData("cryptoRadarPaper",{})?.positions||{}),cooldownId=localData("cryptoRadarCooldown",{})?.coinId,selected=[...document.querySelectorAll(".catalog-native-select")].map(select=>select.value);
  return [...new Set([...pinnedIds(),...(state.portfolio?.holdings||[]).map(h=>h.id),...paperIds,cooldownId,...selected].filter(id=>typeof id==="string"&&id.startsWith("cmc-")))];
}
function normalizeMarketCatalog(items){
  const liveBySlug=new Map(state.scored.map(c=>[c.id,c])),liveByKey=new Map(state.scored.map(c=>[`${c.symbol.toLowerCase()}|${c.name.toLowerCase()}`,c])),liveBySymbol=new Map(),used=new Set();
  state.scored.forEach(c=>{const symbol=c.symbol.toLowerCase();if(!liveBySymbol.has(symbol))liveBySymbol.set(symbol,c);else liveBySymbol.set(symbol,null)});
  const coins=(items||[]).map(item=>{
    const exact=liveBySlug.get(item.cmc_slug)||liveByKey.get(`${item.symbol.toLowerCase()}|${item.name.toLowerCase()}`)||liveBySymbol.get(item.symbol.toLowerCase()),existing=exact&&!used.has(exact.id)?exact:null;
    if(existing){used.add(existing.id);return {...existing,cmcId:item.cmc_id,cmcSlug:item.cmc_slug,cmcRank:item.market_cap_rank,_catalogOnly:false}}
    return {...scoreCoin(item),cmcId:item.cmc_id,cmcSlug:item.cmc_slug,cmcRank:item.market_cap_rank,_catalogOnly:item.catalog_source==="coinmarketcap"};
  });
  coins.forEach((coin,index)=>{
    state.marketCatalogCoins.set(coin.id,coin);
    const catalogId=String((items||[])[index]?.id||"");
    if(catalogId)state.marketCatalogCoins.set(catalogId,coin);
  });
  return coins;
}
function mergeCoinRows(rows,amountKey,costKey){
  const merged=[],indexes=new Map();
  (rows||[]).forEach(row=>{
    const id=canonicalCoinId(row.id),index=indexes.get(id);
    if(index==null){indexes.set(id,merged.length);merged.push({...row,id});return}
    const current=merged[index],currentAmount=num(current[amountKey]),nextAmount=num(row[amountKey]),total=currentAmount+nextAmount;
    current[amountKey]=total;
    if(costKey)current[costKey]=total?(currentAmount*num(current[costKey])+nextAmount*num(row[costKey]))/total:num(current[costKey]||row[costKey]);
  });
  return merged;
}
function canonicalizeCoinReferences(){
  if(state.portfolio?.holdings)state.portfolio.holdings=mergeCoinRows(state.portfolio.holdings,"amount","avgCost");
  if(state.plan?.targets){
    const targets=mergeCoinRows(state.plan.targets,"target",null);
    state.plan.targets=targets.map(target=>({...target,symbol:coinById(target.id)?.symbol?.toUpperCase()||target.symbol}));
  }
  const paper=localData("cryptoRadarPaper",null);
  if(paper?.positions){
    const rows=Object.entries(paper.positions).map(([id,position])=>({id,...position})),positions={};
    mergeCoinRows(rows,"quantity","avgCost").forEach(({id,...position})=>positions[id]=position);
    const trades=(paper.trades||[]).map(trade=>({...trade,coinId:canonicalCoinId(trade.coinId)}));
    saveLocalData("cryptoRadarPaper",{...paper,positions,trades});
  }
  const cooldown=localData("cryptoRadarCooldown",null);
  if(cooldown?.coinId)saveLocalData("cryptoRadarCooldown",{...cooldown,coinId:canonicalCoinId(cooldown.coinId)});
}
function availablePinnedCoins(){const ids=pinnedIds(),catalog=state.marketCatalog.length?state.marketCatalog:state.scored;return catalog.filter(c=>!ids.includes(c.id))}
let pinnedCatalogSearchTimer=null,pinnedCatalogRequest=0;
function queuePinnedCatalogSearch(open=true){
  clearTimeout(pinnedCatalogSearchTimer);
  pinnedCatalogSearchTimer=setTimeout(()=>loadMarketCatalog($("pinnedCoinSearch").value,open),180);
}
async function loadMarketCatalog(query="",open=false){
  const requestId=++pinnedCatalogRequest;
  state.marketCatalogLoading=true;
  if($("pinnedCatalogStatus"))$("pinnedCatalogStatus").textContent=tr("Caricamento catalogo crypto…");
  if(open)renderPinnedOptions(true);
  try{
    const params=new URLSearchParams({q:query,sort:pinnedSortMode(),ids:catalogPersistedCmcIds().join(",")}),response=await api(`/api/market-catalog?${params}`);
    if(requestId!==pinnedCatalogRequest)return;
    state.marketCatalog=normalizeMarketCatalog(response.data);
    state.marketCatalogTotal=num(response.total);
    state.marketCatalogMatched=num(response.matched);
    state.marketCatalogSource=response.source||"unknown";
    state.marketCatalogReliable=response.source==="coinmarketcap";
  }catch{
    if(requestId!==pinnedCatalogRequest)return;
    state.marketCatalog=[...state.scored];
    state.marketCatalog.forEach(coin=>state.marketCatalogCoins.set(coin.id,coin));
    state.marketCatalogTotal=state.scored.length;
    state.marketCatalogMatched=state.scored.length;
    state.marketCatalogSource="fallback";
    state.marketCatalogReliable=false;
  }finally{
    if(requestId!==pinnedCatalogRequest)return;
    state.marketCatalogLoading=false;
    state.marketCatalogLoaded=true;
    canonicalizeCoinReferences();
    syncPlanTargets();
    updatePinnedCatalogStatus();
    renderPinnedOptions(open||$("pinnedCoinSearch").getAttribute("aria-expanded")==="true");
    syncAllCatalogPickers();
    if(state.scored.length&&catalogPersistedCmcIds().length){renderOverview();renderPortfolio();renderPlan();renderOperations();renderCopilot();renderAdvanced()}
  }
}
function updatePinnedCatalogStatus(){
  if(!$("pinnedCatalogStatus"))return;
  $("pinnedCatalogStatus").textContent=state.marketCatalogLoading?tr("Caricamento catalogo crypto…"):state.marketCatalogSource==="coinmarketcap"?`${state.marketCatalogTotal.toLocaleString(uiLocale())} ${tr("crypto disponibili da CoinMarketCap")}`:`${state.marketCatalogTotal||state.scored.length} ${tr("crypto disponibili · catalogo di riserva")}`;
}
function sortPinnedCoins(coins){
  const byName=(a,b)=>a.name.localeCompare(b.name,window.CryptoRadarI18n?.locale?.()||"it-IT",{sensitivity:"base"})||catalogRank(a)-catalogRank(b);
  return [...coins].sort(pinnedSortMode()==="name"?byName:(a,b)=>catalogRank(a)-catalogRank(b)||byName(a,b));
}
function closePinnedOptions(){
  $("pinnedCoinOptions").classList.add("hidden");
  $("pinnedCoinSearch").setAttribute("aria-expanded","false");
  $("pinnedCoinSearch").removeAttribute("aria-activedescendant");
}
function choosePinnedOption(id){
  const coin=pinnedCoinById(id);
  if(!coin)return;
  $("pinnedCoinSelect").value=coin.id;
  $("pinnedCoinSearch").value=`${coin.name} (${coin.symbol.toUpperCase()})`;
  $("addPinned").disabled=pinnedIds().length>=5;
  closePinnedOptions();
  $("addPinned").focus();
}
function renderPinnedOptions(open=true){
  const query=$("pinnedCoinSearch").value.trim().toLocaleLowerCase(),matches=sortPinnedCoins(availablePinnedCoins()).filter(c=>!query||`${c.name} ${c.symbol} ${c.id} ${c.cmcSlug||""} #${catalogRank(c)}`.toLocaleLowerCase().includes(query)),coins=matches.slice(0,100);
  const content=coins.map((c,index)=>`<button type="button" id="pinned-option-${index}" class="pinned-option" role="option" data-pinned-option="${esc(c.id)}" aria-selected="false"><img src="${esc(c.image)}" alt=""><span><b>${esc(c.name)}</b><small>${esc(c.symbol.toUpperCase())}</small></span><strong>#${catalogRank(c)}</strong></button>`).join("");
  const empty=state.marketCatalogLoading?tr("Caricamento catalogo crypto…"):tr("Nessuna crypto trovata. Prova con nome o simbolo.");
  const totalMatches=state.marketCatalogLoaded?Math.max(matches.length,state.marketCatalogMatched):matches.length;
  const footer=matches.length?`<div class="pinned-options-meta">${coins.length} ${tr("di")} ${totalMatches} crypto${totalMatches>coins.length?` · ${tr("scrivi per restringere la ricerca")}`:""}</div>`:"";
  $("pinnedCoinOptions").innerHTML=content||`<div class="pinned-option-empty">${empty}</div>`;
  $("pinnedCoinOptions").insertAdjacentHTML("beforeend",footer);
  document.querySelectorAll("[data-pinned-option]").forEach(button=>button.onclick=()=>choosePinnedOption(button.dataset.pinnedOption));
  if(open){
    $("pinnedCoinOptions").classList.remove("hidden");
    $("pinnedCoinSearch").setAttribute("aria-expanded","true");
  }
}
function movePinnedOption(direction){
  if($("pinnedCoinOptions").classList.contains("hidden"))renderPinnedOptions(true);
  const options=[...document.querySelectorAll("[data-pinned-option]")];
  if(!options.length)return;
  let index=options.findIndex(option=>option.classList.contains("active"));
  index=index<0?(direction>0?0:options.length-1):(index+direction+options.length)%options.length;
  options.forEach((option,optionIndex)=>{const active=optionIndex===index;option.classList.toggle("active",active);option.setAttribute("aria-selected",String(active))});
  $("pinnedCoinSearch").setAttribute("aria-activedescendant",options[index].id);
  options[index].scrollIntoView({block:"nearest"});
}

const catalogPickerDefinitions={
  portfolio:{selectId:"portfolioCoinSelect",defaultId:"",note:"Catalogo esteso per aggiungere fino a 30 posizioni."},
  dca:{selectId:"dcaCoin",defaultId:"bitcoin",note:"Lo storico viene verificato su CoinGecko quando disponibile."},
  copilot:{selectId:"copilotCoin",defaultId:"bitcoin",note:"Gli asset fuori dal campione live usano i campi CoinMarketCap disponibili."},
  trade:{selectId:"tradeCoin",defaultId:"bitcoin",note:"Gli asset fuori dal campione live usano i campi CoinMarketCap disponibili."},
  paper:{selectId:"paperCoin",defaultId:"bitcoin",note:"Prezzi correnti indicativi; operazioni esclusivamente virtuali."},
  execution:{selectId:"executionCoin",defaultId:"bitcoin",note:"La presenza nel catalogo non garantisce una coppia EUR sugli exchange."}
};
const catalogPickers=new Map();
function catalogPickerSort(name){return localStorage.getItem(`cryptoRadarCatalogSort-${name}`)==="name"?"name":"rank"}
function catalogPickerLabel(coin){return `${coin.name} (${coin.symbol.toUpperCase()})`}
function catalogPickerMatches(coin,query){return !query||`${coin.name} ${coin.symbol} ${coin.id} ${coin.cmcSlug||""} #${catalogRank(coin)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())}
function catalogPickerExcluded(name,coin){return name==="portfolio"&&(state.portfolio?.holdings||[]).some(holding=>sameCoinIdentity(holding.id,coin.id))}
function catalogPickerSorted(coins,mode){
  const byName=(a,b)=>a.name.localeCompare(b.name,uiLocale(),{sensitivity:"base"})||catalogRank(a)-catalogRank(b);
  return [...coins].sort(mode==="name"?byName:(a,b)=>catalogRank(a)-catalogRank(b)||byName(a,b));
}
function updateCatalogPickerStatus(picker){
  const total=picker.total||state.marketCatalogTotal||state.scored.length,source=picker.source||state.marketCatalogSource;
  picker.status.textContent=picker.loading?tr("Caricamento catalogo crypto…"):`${total.toLocaleString(uiLocale())} ${source==="coinmarketcap"?tr("crypto disponibili da CoinMarketCap"):tr("crypto disponibili · catalogo di riserva")} · ${tr(picker.definition.note)}`;
}
function closeCatalogPicker(picker){
  picker.options.classList.add("hidden");
  picker.search.setAttribute("aria-expanded","false");
  picker.search.removeAttribute("aria-activedescendant");
}
function clearCatalogPicker(name,notify=true){
  const picker=catalogPickers.get(name);if(!picker)return;
  picker.select.innerHTML=`<option value=""></option>`;picker.select.value="";picker.search.value="";picker.query="";
  if(notify)picker.select.dispatchEvent(new Event("change",{bubbles:true}));
}
function chooseCatalogPicker(name,id,notify=true){
  const picker=catalogPickers.get(name),coin=coinById(id);if(!picker||!coin)return;
  picker.select.innerHTML=`<option value="${esc(coin.id)}" selected>${esc(catalogPickerLabel(coin))}</option>`;
  picker.select.value=coin.id;picker.search.value=catalogPickerLabel(coin);picker.query="";
  closeCatalogPicker(picker);
  if(notify)picker.select.dispatchEvent(new Event("change",{bubbles:true}));
}
function renderCatalogPickerOptions(picker,open=true){
  const matches=catalogPickerSorted(picker.results.filter(coin=>catalogPickerMatches(coin,picker.query)&&!catalogPickerExcluded(picker.name,coin)),picker.sort.value),coins=matches.slice(0,100);
  picker.options.innerHTML=coins.map((coin,index)=>`<button type="button" id="${picker.name}-catalog-option-${index}" class="pinned-option" role="option" data-catalog-option="${esc(coin.id)}" aria-selected="false"><img src="${esc(coin.image)}" alt=""><span><b>${esc(coin.name)}</b><small>${esc(coin.symbol.toUpperCase())}</small></span><strong>#${catalogRank(coin)}</strong></button>`).join("")||`<div class="pinned-option-empty">${picker.loading?tr("Caricamento catalogo crypto…"):tr("Nessuna crypto trovata. Prova con nome o simbolo.")}</div>`;
  if(matches.length){
    const total=Math.max(matches.length,picker.matched);
    picker.options.insertAdjacentHTML("beforeend",`<div class="pinned-options-meta">${coins.length} ${tr("di")} ${total} crypto${total>coins.length?` · ${tr("scrivi per restringere la ricerca")}`:""}</div>`);
  }
  picker.options.querySelectorAll("[data-catalog-option]").forEach(button=>button.onclick=()=>chooseCatalogPicker(picker.name,button.dataset.catalogOption));
  if(open){picker.options.classList.remove("hidden");picker.search.setAttribute("aria-expanded","true")}
}
async function loadCatalogPicker(picker,query="",open=true){
  const requestId=++picker.request;picker.loading=true;picker.query=query.trim();updateCatalogPickerStatus(picker);renderCatalogPickerOptions(picker,open);
  try{
    const params=new URLSearchParams({q:picker.query,sort:picker.sort.value,ids:catalogPersistedCmcIds().join(",")}),response=await api(`/api/market-catalog?${params}`);
    if(requestId!==picker.request)return;
    picker.results=normalizeMarketCatalog(response.data);picker.total=num(response.total);picker.matched=num(response.matched);picker.source=response.source||"unknown";
  }catch{
    if(requestId!==picker.request)return;
    picker.results=[...state.scored];picker.total=state.scored.length;picker.matched=state.scored.length;picker.source="fallback";
  }finally{
    if(requestId!==picker.request)return;
    picker.loading=false;updateCatalogPickerStatus(picker);renderCatalogPickerOptions(picker,open);
  }
}
function queueCatalogPicker(picker){
  clearTimeout(picker.timer);
  picker.timer=setTimeout(()=>loadCatalogPicker(picker,picker.query,true),180);
}
function moveCatalogPickerOption(picker,direction){
  if(picker.options.classList.contains("hidden"))renderCatalogPickerOptions(picker,true);
  const options=[...picker.options.querySelectorAll("[data-catalog-option]")];if(!options.length)return;
  let index=options.findIndex(option=>option.classList.contains("active"));
  index=index<0?(direction>0?0:options.length-1):(index+direction+options.length)%options.length;
  options.forEach((option,optionIndex)=>{const active=optionIndex===index;option.classList.toggle("active",active);option.setAttribute("aria-selected",String(active))});
  picker.search.setAttribute("aria-activedescendant",options[index].id);options[index].scrollIntoView({block:"nearest"});
}
function syncCatalogPicker(name){
  const picker=catalogPickers.get(name);if(!picker)return;
  let coin=coinById(picker.select.value);
  if(coin&&catalogPickerExcluded(name,coin)){clearCatalogPicker(name,false);coin=null}
  if(!coin&&picker.definition.defaultId)coin=coinById(picker.definition.defaultId);
  if(coin)chooseCatalogPicker(name,coin.id,false);
  updateCatalogPickerStatus(picker);
}
function syncAllCatalogPickers(){catalogPickers.forEach((_,name)=>syncCatalogPicker(name));updatePortfolioPickerState();updatePaperPreview()}
function setupCatalogPickers(){
  Object.entries(catalogPickerDefinitions).forEach(([name,definition])=>{
    const select=$(definition.selectId);if(!select||select.classList.contains("catalog-native-select"))return;
    const initialValue=select.value,initialLabel=select.selectedOptions[0]?.textContent||"",searchLabel=select.getAttribute("aria-label")||tr("Cerca una crypto");
    select.classList.add("catalog-native-select");select.setAttribute("aria-hidden","true");select.tabIndex=-1;
    const wrapper=document.createElement("div");wrapper.className="catalog-picker";wrapper.dataset.catalogPicker=name;
    wrapper.innerHTML=`<div class="catalog-picker-row"><div class="catalog-combobox"><input id="${name}CoinSearch" type="search" aria-label="${esc(searchLabel)}" placeholder="${esc(tr("Scrivi nome, simbolo o rank…"))}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${name}CoinOptions"><div id="${name}CoinOptions" class="pinned-options catalog-options hidden" role="listbox"></div></div><select id="${name}CoinSort" class="catalog-sort" aria-label="${esc(tr("Ordina crypto"))}"><option value="rank">${esc(tr("Per rank"))}</option><option value="name">${esc(tr("Alfabetico"))}</option></select></div><small id="${name}CoinStatus" class="pinned-catalog-status">${esc(tr("Caricamento catalogo crypto…"))}</small>`;
    select.insertAdjacentElement("afterend",wrapper);
    const picker={name,definition,select,wrapper,search:$(`${name}CoinSearch`),sort:$(`${name}CoinSort`),options:$(`${name}CoinOptions`),status:$(`${name}CoinStatus`),results:[],total:0,matched:0,source:"",loading:false,query:"",timer:null,request:0};
    const ownerLabel=select.closest("label");if(ownerLabel)ownerLabel.htmlFor=picker.search.id;
    picker.sort.value=catalogPickerSort(name);picker.search.value=initialLabel;catalogPickers.set(name,picker);
    if(initialValue)select.value=initialValue;
    picker.search.onfocus=()=>{picker.search.select();loadCatalogPicker(picker,"",true)};
    picker.search.oninput=()=>{picker.select.value="";picker.query=picker.search.value;picker.select.dispatchEvent(new Event("change",{bubbles:true}));picker.loading=true;renderCatalogPickerOptions(picker,true);queueCatalogPicker(picker)};
    picker.search.onkeydown=event=>{if(event.key==="ArrowDown"){event.preventDefault();moveCatalogPickerOption(picker,1)}else if(event.key==="ArrowUp"){event.preventDefault();moveCatalogPickerOption(picker,-1)}else if(event.key==="Escape"){closeCatalogPicker(picker)}else if(event.key==="Enter"){event.preventDefault();const option=picker.options.querySelector("[data-catalog-option].active")||picker.options.querySelector("[data-catalog-option]");if(option)chooseCatalogPicker(name,option.dataset.catalogOption)}};
    picker.sort.onchange=()=>{localStorage.setItem(`cryptoRadarCatalogSort-${name}`,picker.sort.value);loadCatalogPicker(picker,picker.query,true);picker.search.focus()};
  });
  document.addEventListener("click",event=>{catalogPickers.forEach(picker=>{if(!event.target.closest(`[data-catalog-picker="${picker.name}"]`))closeCatalogPicker(picker)})});
}
function renderPinnedManager(){
  const storedIds=pinnedIds(),ids=[...new Set(storedIds.filter(id=>pinnedCoinById(id)).map(canonicalCoinId))].slice(0,5),coins=ids.map(pinnedCoinById).filter(Boolean);
  if(state.marketCatalogReliable&&JSON.stringify(ids)!==JSON.stringify(storedIds))savePinnedIds(ids);
  $("pinnedCount").textContent=`${ids.length}/5 selezionate`;
  $("pinnedTitle").textContent=ids.length?"Le tue crypto":"Scegli le crypto da seguire";
  $("pinnedCoinSort").value=pinnedSortMode();
  updatePinnedCatalogStatus();
  $("pinnedCoinSearch").value="";
  $("pinnedCoinSelect").value="";
  closePinnedOptions();
  $("pinnedSelection").innerHTML=coins.length?coins.map(c=>`<span class="pinned-chip"><img src="${esc(c.image)}" alt=""><b>${esc(c.symbol.toUpperCase())}</b><button type="button" data-unpin="${esc(c.id)}" aria-label="Rimuovi ${esc(c.name)}">×</button></span>`).join(""):`<p class="muted">Non hai ancora fissato crypto. Cercane una per nome o simbolo.</p>`;
  $("addPinned").disabled=true;
  $("pinnedMessage").textContent=ids.length>=5?"Hai raggiunto il massimo di 5 crypto.":"Le schede non modificano il tuo portafoglio.";
  document.querySelectorAll("[data-unpin]").forEach(button=>button.onclick=()=>{savePinnedIds(ids.filter(id=>id!==button.dataset.unpin));renderOverview()});
}
function addPinnedCoin(){const id=$("pinnedCoinSelect").value,ids=pinnedIds();if(!id||ids.includes(id))return;if(ids.length>=5){$("pinnedMessage").textContent="Puoi fissare al massimo 5 crypto.";return}savePinnedIds([...ids,id]);renderOverview();$("pinnedManager").classList.remove("hidden");$("pinnedCoinSearch").focus();loadMarketCatalog("",true)}
function coinCell(c){return `<div class="token-cell"><img src="${c.image}" alt=""><div><b>${c.symbol.toUpperCase()}</b><span>${c.name}</span></div></div>`}
function scoreColor(score){return score>=70?"positive":score>=52?"neutral":"negative"}
function reasons(c){
  const result=[];
  if(change(c,"30d")>12) result.push("momentum 30g forte"); else if(change(c,"7d")>4) result.push("forza positiva a 7g");
  if(c._liquidity>=70) result.push("buona liquidità");
  if(c._dilution<=1.15) result.push("diluizione contenuta");
  if(c._risk==="basso") result.push("volatilità più contenuta");
  if(!result.length) result.push("profilo bilanciato nei filtri");
  return result.slice(0,2).join(" · ");
}

function renderHomeLanguage(){
  const language=window.CryptoRadarI18n?.language()||localStorage.getItem("cryptoRadarLanguage")||"it";
  document.querySelectorAll("[data-home-language]").forEach(button=>{
    const active=button.dataset.homeLanguage===language;
    button.classList.toggle("active",active);
    button.setAttribute("aria-pressed",String(active));
  });
}

function renderWeeklyMovers(){
  const gainers=state.marketMovers?.gainers||[],losers=state.marketMovers?.losers||[];
  const moverRow=(asset,index)=>{const matched=state.scored.find(c=>c.symbol.toUpperCase()===asset.symbol&&c.name.toLowerCase()===asset.name.toLowerCase())||state.scored.find(c=>c.symbol.toUpperCase()===asset.symbol);return `<button type="button" class="mover-row" ${matched?`data-mover-id="${esc(matched.id)}"`:`data-cmc-slug="${esc(asset.slug)}"`}><span class="mover-position">${index+1}</span><span class="mover-coin"><img src="${esc(asset.image)}" alt=""><span><b>${esc(asset.name)}</b><small>${esc(asset.symbol)} · CMC rank #${num(asset.rank)}</small></span></span><span class="mover-price"><b>${fmtEur(asset.price)}</b><small>${fmtEur(asset.marketCap,true)} market cap</small></span><strong class="${pctClass(num(asset.change7d))}">${fmtPct(num(asset.change7d))}</strong></button>`};
  $("weeklyGainersCount").textContent=`${gainers.length}/5`;
  $("weeklyLosersCount").textContent=`${losers.length}/5`;
  const unavailable=state.marketMovers?.error?`CoinMarketCap è momentaneamente non disponibile: ${esc(state.marketMovers.error)}`:"Nessun dato settimanale disponibile nel campione CoinMarketCap.";
  $("weeklyGainers").innerHTML=gainers.map(moverRow).join("")||`<p class="mover-empty muted">${unavailable}</p>`;
  $("weeklyLosers").innerHTML=losers.map(moverRow).join("")||`<p class="mover-empty muted">${unavailable}</p>`;
  const asOf=new Date(state.marketMovers?.asOf||"");
  $("weeklyMoversMeta").textContent=Number.isNaN(asOf.valueOf())?"In attesa dei dati":asOf.toLocaleString(uiLocale(),{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
  document.querySelectorAll("[data-mover-id]").forEach(button=>button.onclick=()=>openDetail(button.dataset.moverId));
  document.querySelectorAll("[data-cmc-slug]").forEach(button=>button.onclick=()=>window.open(`https://coinmarketcap.com/currencies/${encodeURIComponent(button.dataset.cmcSlug)}/`,"_blank","noopener,noreferrer"));
}

const homeLayoutStore="cryptoRadarHomeLayoutV1";
const homeWidgetCatalog=[
  {id:"snapshot",label:"Mercato e lingua",description:"Regime, BTC, ETH, ampiezza e cambio lingua"},
  {id:"market-temperature",label:"Temperatura del mercato",description:"Fear & Greed, Altcoin Season, dominanza BTC e CMC100"},
  {id:"portfolio-pulse",label:"Sintesi portafoglio",description:"Valore, risultato indicativo e concentrazione personale"},
  {id:"movers",label:"Movimenti settimanali",description:"Migliori e peggiori dati CoinMarketCap a 7 giorni"},
  {id:"pinned",label:"Crypto fissate",description:"Fino a cinque asset scelti personalmente"},
  {id:"candidates",label:"Candidate emerse",description:"Risultati quantitativi dello screener"},
  {id:"italian-news",label:"Notizie",description:"Titoli da Criptovaluta.it, BeInCrypto Italia e The Crypto Gateway"},
  {id:"quick-actions",label:"Azioni rapide",description:"Collegamenti ad Assistente Personale, Laboratorio, guide e fisco"}
];
const defaultHomeOrder=homeWidgetCatalog.map(widget=>widget.id);
function homeLayout(){
  const saved=localData(homeLayoutStore,{}),known=new Set(defaultHomeOrder),savedOrder=Array.isArray(saved.order)?saved.order.filter(id=>known.has(id)):[];
  return {order:[...new Set([...savedOrder,...defaultHomeOrder])],hidden:Array.isArray(saved.hidden)?[...new Set(saved.hidden.filter(id=>known.has(id)))]:[]};
}
function persistHomeLayout(layout){saveLocalData(homeLayoutStore,layout);applyHomeLayout()}
function applyHomeLayout(refreshManager=true){
  const area=$("homeWidgetArea"),layout=homeLayout();if(!area)return;
  layout.order.forEach(id=>{const widget=area.querySelector(`[data-home-widget="${id}"]`);if(widget)area.appendChild(widget)});
  area.querySelectorAll("[data-home-widget]").forEach(widget=>widget.classList.toggle("home-widget-off",layout.hidden.includes(widget.dataset.homeWidget)));
  if(refreshManager)renderHomeLayoutManager();
}
function renderHomeLayoutManager(){
  const list=$("homeWidgetManagerList");if(!list)return;const layout=homeLayout(),catalog=new Map(homeWidgetCatalog.map(widget=>[widget.id,widget])),visibleLabel="Visibile",moveUp="Sposta su",moveDown="Sposta giù";
  list.innerHTML=layout.order.map((id,index)=>{const widget=catalog.get(id);if(!widget)return"";return `<div class="home-widget-manager-row" draggable="true" data-home-manager-id="${esc(id)}"><span class="home-drag-handle" title="Trascina per riordinare">⋮⋮</span><div><b>${esc(widget.label)}</b><small>${esc(widget.description)}</small></div><label><input type="checkbox" data-home-visible="${esc(id)}" ${layout.hidden.includes(id)?"":"checked"}> ${visibleLabel}</label><div class="home-order-buttons"><button type="button" data-home-move="-1" data-home-move-id="${esc(id)}" title="${moveUp}" aria-label="${moveUp}" ${index===0?"disabled":""}>↑</button><button type="button" data-home-move="1" data-home-move-id="${esc(id)}" title="${moveDown}" aria-label="${moveDown}" ${index===layout.order.length-1?"disabled":""}>↓</button></div></div>`}).join("");
  list.querySelectorAll("[data-home-visible]").forEach(input=>input.onchange=()=>{const next=homeLayout(),hidden=new Set(next.hidden);input.checked?hidden.delete(input.dataset.homeVisible):hidden.add(input.dataset.homeVisible);persistHomeLayout({...next,hidden:[...hidden]})});
  list.querySelectorAll("[data-home-move-id]").forEach(button=>button.onclick=()=>moveHomeWidget(button.dataset.homeMoveId,num(button.dataset.homeMove)));
  list.querySelectorAll("[data-home-manager-id]").forEach(row=>{
    row.ondragstart=event=>{event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",row.dataset.homeManagerId);row.classList.add("dragging")};
    row.ondragover=event=>{event.preventDefault();event.dataTransfer.dropEffect="move";row.classList.add("drag-over")};
    row.ondragleave=()=>row.classList.remove("drag-over");
    row.ondrop=event=>{event.preventDefault();const source=event.dataTransfer.getData("text/plain"),target=row.dataset.homeManagerId;reorderHomeWidget(source,target)};
    row.ondragend=()=>list.querySelectorAll(".dragging,.drag-over").forEach(item=>item.classList.remove("dragging","drag-over"));
  });
  window.CryptoRadarI18n?.translateDocument();
}
function moveHomeWidget(id,direction){const layout=homeLayout(),from=layout.order.indexOf(id),to=clamp(from+direction,0,layout.order.length-1);if(from<0||from===to)return;layout.order.splice(from,1);layout.order.splice(to,0,id);persistHomeLayout(layout)}
function reorderHomeWidget(source,target){if(!source||source===target)return;const layout=homeLayout(),from=layout.order.indexOf(source),to=layout.order.indexOf(target);if(from<0||to<0)return;layout.order.splice(from,1);layout.order.splice(to,0,source);persistHomeLayout(layout)}
function toggleHomeLayout(open){$("homeLayoutManager").classList.toggle("hidden",!open);$("openHomeLayout").classList.toggle("active",open);if(open){renderHomeLayoutManager();$("homeLayoutManager").scrollIntoView({behavior:"smooth",block:"nearest"})}}
function resetHomeLayout(){localStorage.removeItem(homeLayoutStore);applyHomeLayout();$("homeLayoutStatus").textContent="Impostazione iniziale ripristinata";window.CryptoRadarI18n?.translateDocument()}

const sidebarLayoutStore="cryptoRadarSidebarLayoutV1";
const sidebarDefaultTargets=[...document.querySelectorAll("#sidebarNav .nav")].map(button=>button.dataset.target);
const sidebarDefaultGroups=[...document.querySelectorAll("[data-sidebar-group]")].map(group=>group.dataset.sidebarGroup);
const sidebarPresetTargets={
  essential:["purpose","overview","screener","portfolio","news","method"],
  portfolio:["overview","portfolio","connections","academy","plan","copilot","decision","operations","tax","method"],
  analysis:["overview","screener","decision","operations","advanced","intelligence","news","method"],
  community:["overview","academy","community","news","tax","method"],
  complete:sidebarDefaultTargets
};
function normalizedSidebarOrder(value,defaults){
  const known=new Set(defaults),ordered=Array.isArray(value)?[...new Set(value.filter(item=>known.has(item)))]:[];
  return [...ordered,...defaults.filter(item=>!ordered.includes(item))];
}
function sidebarLayout(){
  const saved=localData(sidebarLayoutStore,{}),knownTargets=new Set(sidebarDefaultTargets),knownGroups=new Set(sidebarDefaultGroups);
  return {
    hidden:Array.isArray(saved.hidden)?[...new Set(saved.hidden.filter(target=>knownTargets.has(target)&&target!=="overview"))]:[],
    collapsed:Array.isArray(saved.collapsed)?[...new Set(saved.collapsed.filter(group=>knownGroups.has(group)))]:[],
    density:saved.density==="compact"?"compact":"comfortable",
    order:normalizedSidebarOrder(saved.order,sidebarDefaultTargets),
    groupOrder:normalizedSidebarOrder(saved.groupOrder,sidebarDefaultGroups)
  };
}
function sidebarPreset(layout=sidebarLayout()){
  const visible=sidebarDefaultTargets.filter(target=>target==="overview"||!layout.hidden.includes(target));
  return Object.entries(sidebarPresetTargets).find(([,targets])=>targets.length===visible.length&&targets.every(target=>visible.includes(target)))?.[0]||"";
}
function persistSidebarLayout(layout,status="Configurazione aggiornata"){saveLocalData(sidebarLayoutStore,layout);applySidebarLayout();if($("sidebarLayoutStatus"))$("sidebarLayoutStatus").textContent=status}
function applySidebarLayout(refreshManager=true){
  const layout=sidebarLayout(),sidebar=document.querySelector(".sidebar"),nav=$("sidebarNav");if(!sidebar||!nav)return;
  layout.groupOrder.forEach(groupId=>{const group=nav.querySelector(`[data-sidebar-group="${groupId}"]`);if(group)nav.append(group)});
  document.querySelectorAll("[data-sidebar-group]").forEach(group=>{
    const items=group.querySelector(".sidebar-group-items");
    layout.order.forEach(target=>{const button=group.querySelector(`.nav[data-target="${target}"]`);if(button)items.append(button)});
  });
  sidebar.classList.toggle("sidebar-density-compact",layout.density==="compact");
  document.querySelectorAll("[data-sidebar-group]").forEach(group=>{
    const collapsed=layout.collapsed.includes(group.dataset.sidebarGroup),toggle=group.querySelector(".sidebar-group-toggle");
    group.classList.toggle("collapsed",collapsed);
    toggle?.setAttribute("aria-expanded",String(!collapsed));
  });
  document.querySelectorAll("#sidebarNav .nav").forEach(button=>{
    const hidden=layout.hidden.includes(button.dataset.target)&&button.dataset.target!==state.currentPage;
    button.classList.toggle("sidebar-module-hidden",hidden);
    button.title=button.textContent.trim();
  });
  document.querySelectorAll("[data-sidebar-group]").forEach(group=>{
    const available=[...group.querySelectorAll(".nav")].some(button=>!button.classList.contains("sidebar-module-hidden")&&!(interfaceMode()==="beginner"&&button.classList.contains("advanced-only")));
    group.classList.toggle("sidebar-group-empty",!available);
  });
  document.querySelectorAll("[data-sidebar-density]").forEach(button=>button.classList.toggle("active",button.dataset.sidebarDensity===layout.density));
  document.querySelectorAll("[data-sidebar-interface]").forEach(button=>button.classList.toggle("active",button.dataset.sidebarInterface===interfaceMode()));
  requestAnimationFrame(()=>alignMobileSidebarTarget(state.currentPage));
  if(refreshManager)renderSidebarLayoutManager();
}
function alignMobileSidebarTarget(target){
  if(!window.matchMedia("(max-width:760px)").matches)return;
  const nav=$("sidebarNav"),button=nav?.querySelector(`.nav[data-target="${target}"]:not(.sidebar-module-hidden)`);if(!nav||!button)return;
  const navRect=nav.getBoundingClientRect(),buttonRect=button.getBoundingClientRect(),left=nav.scrollLeft+buttonRect.left-navRect.left-(navRect.width-buttonRect.width)/2;
  nav.scrollTo({left:Math.max(0,left),behavior:"auto"});
}
function renderSidebarLayoutManager(){
  const list=$("sidebarModuleManagerList");if(!list)return;const layout=sidebarLayout(),groups=layout.groupOrder.map(groupId=>document.querySelector(`[data-sidebar-group="${groupId}"]`)).filter(Boolean);
  list.innerHTML=groups.map((group,groupIndex)=>{
    const groupId=group.dataset.sidebarGroup,groupLabel=group.querySelector(".sidebar-group-toggle b")?.textContent.trim()||"Sezioni";
    const buttons=layout.order.map(target=>group.querySelector(`.nav[data-target="${target}"]`)).filter(Boolean);
    const toggleable=buttons.filter(button=>button.dataset.target!=="overview"),visibleCount=toggleable.filter(button=>!layout.hidden.includes(button.dataset.target)).length;
    const rows=buttons.map((button,index)=>{
      const target=button.dataset.target,pinned=target==="overview",advanced=button.classList.contains("advanced-only"),inputId=`sidebar-visible-${target}`;
      return `<div class="sidebar-module-manager-row"><span class="sidebar-manager-dot" data-sidebar-manager-color="${esc(groupId)}"></span><label class="sidebar-module-manager-copy" for="${esc(inputId)}"><b>${esc(button.textContent.trim())}</b><small>${pinned?"Sempre visibile":advanced?"Modalità avanzata":esc(groupLabel)}</small></label><div class="sidebar-manager-row-actions"><button class="sidebar-order-button" type="button" data-sidebar-move="${esc(target)}" data-sidebar-move-direction="-1" aria-label="Sposta su" title="Sposta su" ${index===0?"disabled":""}>↑</button><button class="sidebar-order-button" type="button" data-sidebar-move="${esc(target)}" data-sidebar-move-direction="1" aria-label="Sposta giù" title="Sposta giù" ${index===buttons.length-1?"disabled":""}>↓</button><label class="sidebar-visibility-switch" title="${pinned?"Sempre visibile":"Mostra o nascondi"}"><input id="${esc(inputId)}" type="checkbox" data-sidebar-visible="${esc(target)}" ${layout.hidden.includes(target)?"":"checked"} ${pinned?"disabled":""}></label></div></div>`;
    }).join("");
    return `<div class="sidebar-manager-group"><div class="sidebar-manager-group-head"><div class="sidebar-manager-group-title"><span class="sidebar-manager-dot" data-sidebar-manager-color="${esc(groupId)}"></span><b>${esc(groupLabel)}</b></div><div class="sidebar-manager-group-actions"><button class="sidebar-order-button" type="button" data-sidebar-group-move="${esc(groupId)}" data-sidebar-move-direction="-1" aria-label="Sposta gruppo su" title="Sposta gruppo su" ${groupIndex===0?"disabled":""}>↑</button><button class="sidebar-order-button" type="button" data-sidebar-group-move="${esc(groupId)}" data-sidebar-move-direction="1" aria-label="Sposta gruppo giù" title="Sposta gruppo giù" ${groupIndex===groups.length-1?"disabled":""}>↓</button><label class="sidebar-visibility-switch" title="Mostra o nascondi il gruppo"><input type="checkbox" data-sidebar-group-visible="${esc(groupId)}" ${visibleCount?"checked":""}></label></div></div>${rows}</div>`;
  }).join("");
  list.querySelectorAll("[data-sidebar-group-visible]").forEach(input=>{
    const group=document.querySelector(`[data-sidebar-group="${input.dataset.sidebarGroupVisible}"]`),targets=[...group.querySelectorAll(".nav")].map(button=>button.dataset.target).filter(target=>target!=="overview"),visible=targets.filter(target=>!layout.hidden.includes(target)).length;
    input.indeterminate=visible>0&&visible<targets.length;
    input.onchange=()=>{const next=sidebarLayout(),hidden=new Set(next.hidden);targets.forEach(target=>input.checked?hidden.delete(target):hidden.add(target));persistSidebarLayout({...next,hidden:[...hidden]},"Gruppo aggiornato")};
  });
  list.querySelectorAll("[data-sidebar-visible]").forEach(input=>input.onchange=()=>{
    const next=sidebarLayout(),hidden=new Set(next.hidden);
    input.checked?hidden.delete(input.dataset.sidebarVisible):hidden.add(input.dataset.sidebarVisible);
    persistSidebarLayout({...next,hidden:[...hidden]});
  });
  list.querySelectorAll("[data-sidebar-move]").forEach(button=>button.onclick=()=>moveSidebarTarget(button.dataset.sidebarMove,num(button.dataset.sidebarMoveDirection)));
  list.querySelectorAll("[data-sidebar-group-move]").forEach(button=>button.onclick=()=>moveSidebarGroup(button.dataset.sidebarGroupMove,num(button.dataset.sidebarMoveDirection)));
  const activePreset=sidebarPreset(layout);
  document.querySelectorAll("[data-sidebar-preset]").forEach(button=>button.classList.toggle("active",button.dataset.sidebarPreset===activePreset));
  document.querySelectorAll("[data-sidebar-interface]").forEach(button=>button.classList.toggle("active",button.dataset.sidebarInterface===interfaceMode()));
  window.CryptoRadarI18n?.translateDocument();
}
function moveSidebarTarget(target,direction){
  const layout=sidebarLayout(),button=document.querySelector(`#sidebarNav .nav[data-target="${target}"]`),group=button?.closest("[data-sidebar-group]");if(!group)return;
  const groupTargets=layout.order.filter(item=>group.querySelector(`.nav[data-target="${item}"]`)),index=groupTargets.indexOf(target),swapTarget=groupTargets[index+direction];if(!swapTarget)return;
  const nextOrder=[...layout.order],from=nextOrder.indexOf(target),to=nextOrder.indexOf(swapTarget);[nextOrder[from],nextOrder[to]]=[nextOrder[to],nextOrder[from]];
  persistSidebarLayout({...layout,order:nextOrder},"Ordine aggiornato");
}
function moveSidebarGroup(groupId,direction){
  const layout=sidebarLayout(),nextOrder=[...layout.groupOrder],from=nextOrder.indexOf(groupId),to=from+direction;if(from<0||to<0||to>=nextOrder.length)return;
  [nextOrder[from],nextOrder[to]]=[nextOrder[to],nextOrder[from]];
  persistSidebarLayout({...layout,groupOrder:nextOrder},"Ordine gruppi aggiornato");
}
function setSidebarPreset(preset){
  const targets=sidebarPresetTargets[preset];if(!targets)return;const visible=new Set(targets),layout=sidebarLayout(),hidden=sidebarDefaultTargets.filter(target=>target!=="overview"&&!visible.has(target));
  persistSidebarLayout({...layout,hidden},`Percorso ${preset==="essential"?"Essenziale":preset==="portfolio"?"Portafoglio":preset==="analysis"?"Analisi":preset==="community"?"Community":"Completo"} attivo`);
}
function toggleSidebarGroup(groupId){
  const layout=sidebarLayout(),collapsed=new Set(layout.collapsed);
  collapsed.has(groupId)?collapsed.delete(groupId):collapsed.add(groupId);
  persistSidebarLayout({...layout,collapsed:[...collapsed]});
}
function revealSidebarTarget(target){
  const button=document.querySelector(`#sidebarNav .nav[data-target="${target}"]`),group=button?.closest("[data-sidebar-group]");if(!group)return;
  const layout=sidebarLayout();if(!layout.collapsed.includes(group.dataset.sidebarGroup))return;
  persistSidebarLayout({...layout,collapsed:layout.collapsed.filter(id=>id!==group.dataset.sidebarGroup)});
}
function setSidebarDensity(density){const layout=sidebarLayout();persistSidebarLayout({...layout,density:density==="compact"?"compact":"comfortable"})}
function setSidebarInterface(mode){applyInterfaceMode(mode==="advanced"?"advanced":"beginner");renderSidebarLayoutManager();if($("sidebarLayoutStatus"))$("sidebarLayoutStatus").textContent="Modalità aggiornata"}
function toggleSidebarLayout(open){
  $("sidebarLayoutManager").classList.toggle("hidden",!open);
  $("sidebarLayoutManager").setAttribute("aria-modal",String(open&&window.matchMedia("(max-width:760px)").matches));
  $("sidebarLayoutBackdrop").classList.toggle("hidden",!open);
  $("openSidebarLayout").classList.toggle("active",open);
  $("openSidebarLayout").setAttribute("aria-expanded",String(open));
  document.body.classList.toggle("sidebar-layout-open",open);
  if(open){renderSidebarLayoutManager();setTimeout(()=>$("closeSidebarLayout").focus(),0)}
}
function resetSidebarLayout(){localStorage.removeItem(sidebarLayoutStore);applySidebarLayout();$("sidebarLayoutStatus").textContent="Impostazione iniziale ripristinata"}

function renderHomePortfolioPulse(holdings=state.portfolio?.holdings||[]){
  const positions=holdings.map(holding=>{const coin=coinById(holding.id),value=num(holding.amount)*num(coin?.current_price),cost=num(holding.amount)*num(holding.avgCost);return {...holding,coin,value,cost}}).filter(position=>position.value>0).sort((a,b)=>b.value-a.value),value=positions.reduce((sum,position)=>sum+position.value,0),cost=positions.reduce((sum,position)=>sum+position.cost,0),completeCost=positions.length>0&&positions.every(position=>position.cost>0),pnl=value-cost,pct=cost?pnl/cost*100:0,largest=positions[0],largestWeight=value&&largest?largest.value/value*100:0,limit=num(state.plan?.maxSingleCoin);
  $("homePortfolioValue").textContent=fmtEur(value);$("homePortfolioPositions").textContent=`${positions.length}/30`;
  $("homePortfolioPnl").textContent=completeCost?fmtEur(pnl):"—";$("homePortfolioPnl").className=completeCost?pctClass(pnl):"neutral";$("homePortfolioPnlPct").textContent=completeCost?fmtPct(pct):positions.length?"Costo medio incompleto":"Portafoglio non compilato";
  $("homePortfolioLargest").textContent=largest?.symbol||"—";$("homePortfolioLargestWeight").textContent=largest?`${largestWeight.toFixed(1)}%`:"Portafoglio non compilato";
  const risk=!positions.length?["Da configurare","Aggiungi quantità e costo medio","neutral"]:!limit?["Limite mancante","Definisci il piano personale","neutral"]:largestWeight>limit?["Da riequilibrare",`${largestWeight.toFixed(1)}% / ${limit.toFixed(0)}%`,"negative"]:positions.length===1?["Concentrato",`${largestWeight.toFixed(1)}% / ${limit.toFixed(0)}%`,"neutral"]:["Nel limite",`${largestWeight.toFixed(1)}% / ${limit.toFixed(0)}%`,"positive"];
  $("homePortfolioRisk").textContent=risk[0];$("homePortfolioRisk").className=risk[2];$("homePortfolioRiskText").textContent=risk[1];
  window.CryptoRadarI18n?.translateDocument();
}

function renderOverview(){
  const btc=coinById("bitcoin"),eth=coinById("ethereum"); if(!btc||!eth)return;
  renderHomeLanguage();
  $("btc24").textContent=fmtPct(change(btc,"24h")); $("btc24").className=pctClass(change(btc,"24h")); $("btcPrice").textContent=fmtEur(btc.current_price);
  $("eth24").textContent=fmtPct(change(eth,"24h")); $("eth24").className=pctClass(change(eth,"24h")); $("ethPrice").textContent=fmtEur(eth.current_price);
  const top50=state.scored.filter(c=>c.market_cap_rank<=50&&!stableLike(c));
  const breadth=top50.filter(c=>change(c,"7d")>0).length/top50.length*100;
  $("breadth").textContent=`${breadth.toFixed(0)}%`;
  const regimeScore=(btc._score*.4+eth._score*.25+breadth*.35);
  const regime=regimeScore>=65?["Costruttivo","Trend e ampiezza favorevoli.","var(--accent)"]:regimeScore>=48?["Misto","Segnali contrastanti: selettività e size contenute.","var(--yellow)"]:["Difensivo","Momentum o ampiezza deboli: priorità al controllo del rischio.","var(--red)"];
  $("regimeLabel").textContent=regime[0]; $("regimeText").textContent=regime[1]; $("regimeDot").style.background=regime[2];
  renderWeeklyMovers();
  const selectedPinned=pinnedIds(),pinned=selectedPinned.map(pinnedCoinById).filter(Boolean);
  $("pinnedCards").classList.remove("skeleton-grid");
  $("pinnedCards").innerHTML=pinned.length?pinned.map(c=>`<article class="card coin-card" data-id="${c.id}" title="Apri analisi e grafico"><div class="coin-top"><div class="coin-id"><img src="${c.image}" alt=""><div><b>${c.name}</b><span>${c.symbol.toUpperCase()} · rank #${c.market_cap_rank}</span></div></div><div class="score ${scoreColor(c._score)}">${c._score}<small>SCORE</small></div></div><div class="coin-stats"><div><span>PREZZO</span><b>${fmtEur(c.current_price)}</b></div><div><span>7 GIORNI</span><b class="${pctClass(change(c,"7d"))}">${fmtPct(change(c,"7d"))}</b></div><div><span>30 GIORNI</span><b class="${pctClass(change(c,"30d"))}">${fmtPct(change(c,"30d"))}</b></div><div><span>RISCHIO</span><b class="${c._risk==='alto'?'negative':c._risk==='medio'?'neutral':'positive'}">${c._risk}</b></div></div></article>`).join(""):`<article class="card pinned-empty"><b>La Home è pronta per essere personalizzata</b><p>Premi “Gestisci” e aggiungi da 1 a 5 crypto che vuoi seguire.</p><button class="primary" data-open-pinned>Configura le posizioni fissate</button></article>`;
  renderPinnedManager();
  document.querySelectorAll("[data-open-pinned]").forEach(button=>button.onclick=()=>{$("pinnedManager").classList.remove("hidden");$("pinnedCoinSearch").focus();renderPinnedOptions(true)});
  document.querySelectorAll(".coin-card").forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
  const candidates=state.scored.filter(eligible).filter(c=>![...selectedPinned,"bitcoin","ethereum"].includes(c.id)).slice(0,6);
  $("topCandidates").innerHTML=candidates.map(c=>`<tr data-id="${c.id}"><td>${coinCell(c)}</td><td class="${scoreColor(c._score)}"><b>${c._score}</b></td><td class="reason">${reasons(c)}</td><td>${fmtEur(c.current_price)}</td><td class="${pctClass(change(c,"7d"))}">${fmtPct(change(c,"7d"))}</td><td class="${pctClass(change(c,"30d"))}">${fmtPct(change(c,"30d"))}</td><td><span class="badge ${c._risk}">${c._risk}</span></td></tr>`).join("");
  bindRows($("topCandidates"));
  renderHomePortfolioPulse();renderHomeMarketTemperature();applyHomeLayout();
}

function renderScreener(){
  const minCap=num($("minCap").value)*1e6,minVol=num($("minVolume").value)*1e6,maxPrice=num($("maxPrice").value),maxRisk=$("maxRisk").value;
  const riskAllowed=maxRisk==="all"?["basso","medio","alto"]:maxRisk==="medio"?["basso","medio"]:["basso"];
  const rows=state.scored.filter(eligible).filter(c=>c.market_cap>=minCap&&c.total_volume>=minVol&&(!maxPrice||c.current_price<=maxPrice)&&riskAllowed.includes(c._risk)).slice(0,50);
  $("screenerRows").innerHTML=rows.map(c=>`<tr data-id="${c.id}"><td>${c.market_cap_rank}</td><td>${coinCell(c)}</td><td class="${scoreColor(c._score)}"><b>${c._score}</b></td><td class="reason">${reasons(c)}</td><td>${fmtEur(c.current_price)}</td><td>${fmtEur(c.market_cap,true)}</td><td class="${pctClass(change(c,"7d"))}">${fmtPct(change(c,"7d"))}</td><td class="${pctClass(change(c,"30d"))}">${fmtPct(change(c,"30d"))}</td><td>${c._dilution.toFixed(2)}×</td><td><span class="badge ${c._risk}">${c._risk}</span></td></tr>`).join("");
  $("resultCount").textContent=`${rows.length} risultati mostrati`;
  bindRows($("screenerRows"));
}
function bindRows(tbody){tbody.querySelectorAll("tr[data-id]").forEach(row=>row.onclick=()=>openDetail(row.dataset.id))}

function updatePortfolioPickerState(){
  if(!state.portfolio||!$("portfolioCoinSelect"))return;
  const holdings=state.portfolio.holdings||[],selectedId=$("portfolioCoinSelect").value;
  if(selectedId&&holdings.some(holding=>sameCoinIdentity(holding.id,selectedId)))clearCatalogPicker("portfolio",false);
  $("addPortfolioCoin").disabled=!$("portfolioCoinSelect").value||holdings.length>=30;
}
function renderPortfolio(){
  if(!state.portfolio)return;
  const holdings=state.portfolio.holdings;
  syncCatalogPicker("portfolio");updatePortfolioPickerState();
  $("holdingEditors").innerHTML=holdings.length?holdings.map((h,i)=>{const c=coinById(h.id);return `<article class="card holding-row" data-index="${i}"><div class="holding-name">${c?`<img src="${c.image}" alt="">`:""}<div><b>${c?.name||h.symbol}</b><span>${h.symbol} · ${c?fmtEur(c.current_price):"dato non disponibile"}</span></div></div><label>Quantità<input class="amount" type="number" min="0" step="any" value="${h.amount||""}" placeholder="0"></label><label>Prezzo medio (€)<input class="avg-cost" type="number" min="0" step="any" value="${h.avgCost||""}" placeholder="0"></label><div class="holding-value"><span>VALORE ATTUALE</span><b>${fmtEur((h.amount||0)*(c?.current_price||0))}</b></div><button class="holding-remove" data-remove-holding="${esc(h.id)}" aria-label="Rimuovi ${esc(h.symbol)}">×</button></article>`}).join(""):`<article class="card portfolio-empty"><b>Il portafoglio è vuoto</b><p>Aggiungi la prima crypto dal selettore. I dati rimarranno sul tuo browser nella demo pubblica.</p></article>`;
  document.querySelectorAll(".holding-row input").forEach(input=>input.oninput=previewPortfolio);
  document.querySelectorAll("[data-remove-holding]").forEach(button=>button.onclick=()=>removePortfolioCoin(button.dataset.removeHolding));
  previewPortfolio();
}
function portfolioDraft(){return [...document.querySelectorAll(".holding-row")].map(row=>{const original=state.portfolio.holdings[num(row.dataset.index)];return {...original,amount:num(row.querySelector(".amount").value),avgCost:num(row.querySelector(".avg-cost").value)}})}
function previewPortfolio(){
  if(!state.portfolio)return; const holdings=portfolioDraft(); let value=0,cost=0;
  holdings.forEach(h=>{value+=h.amount*num(coinById(h.id)?.current_price);cost+=h.amount*h.avgCost}); const pnl=value-cost,pct=cost?pnl/cost*100:0;
  $("portfolioValue").textContent=fmtEur(value);$("portfolioCost").textContent=fmtEur(cost);$("portfolioPnl").textContent=fmtEur(pnl);$("portfolioPnl").className=pctClass(pnl);$("portfolioPnlPct").textContent=fmtPct(pct);
  renderPortfolioInsights(holdings,value);renderHomePortfolioPulse(holdings);
}
function renderPortfolioInsights(holdings,total){
  const positions=holdings.map(h=>({...h,value:h.amount*num(coinById(h.id)?.current_price)})).filter(h=>h.value>0).sort((a,b)=>b.value-a.value);
  $("allocationBars").innerHTML=positions.length?positions.map(h=>`<div class="allocation-row"><b>${esc(h.symbol)}</b><div class="bar-track"><div class="bar-fill" style="width:${(h.value/total*100).toFixed(1)}%"></div></div><span>${(h.value/total*100).toFixed(0)}%</span></div>`).join(""):`<p class="muted">Inserisci quantità e prezzo medio per vedere l'allocazione.</p>`;
  const insights=[];
  if(!positions.length) insights.push(["","Il controllo del rischio si attiverà dopo l'inserimento delle posizioni."]);
  if(positions.length && positions[0].value/total>.5) insights.push(["danger",`${positions[0].symbol} pesa ${(positions[0].value/total*100).toFixed(0)}%: concentrazione elevata.`]);
  if(positions.filter(h=>["polygon-ecosystem-token","algorand","cardano"].includes(h.id)).length>=2) insights.push(["warn","POL, ALGO e ADA sono progetti infrastrutturali: possono muoversi insieme durante fasi negative delle altcoin."]);
  const weak=positions.filter(h=>num(coinById(h.id)?._score)<52).map(h=>h.symbol);
  if(weak.length) insights.push(["warn",`${weak.join(", ")} ha uno score debole: richiede una revisione della tesi, non una vendita automatica.`]);
  if(positions.length && !positions.some(h=>["bitcoin","ethereum"].includes(h.id))) insights.push(["","Il portafoglio inserito non contiene BTC o ETH come benchmark; confronta sempre le performance anche con loro."]);
  if(positions.length && !insights.length) insights.push(["","Nessuna criticità quantitativa evidente nei controlli attuali."]);
  $("riskInsights").innerHTML=insights.map(x=>`<div class="risk-item ${x[0]}">${esc(x[1])}</div>`).join("");
}
function syncPlanTargets(){if(!state.plan)return;const previous=new Map((Array.isArray(state.plan.targets)?state.plan.targets:[]).map(t=>[t.id,t]));state.plan.targets=(state.portfolio?.holdings||[]).map(h=>previous.get(h.id)||{id:h.id,symbol:h.symbol,target:0}).slice(0,30)}
async function persistPortfolio(holdings){const payload={currency:"eur",holdings};if(state.demo){saveLocalData("cryptoRadarPortfolio",payload);return payload}return api("/api/portfolio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})}
async function savePortfolio(){try{state.portfolio=await persistPortfolio(portfolioDraft());syncPlanTargets();if(state.demo)saveLocalData("cryptoRadarPlan",state.plan);renderPortfolio();renderPlan();renderDecisionLab();renderCopilot();renderDataQuality();$("savePortfolio").textContent="Salvato ✓";setTimeout(()=>$("savePortfolio").textContent="Salva portafoglio",1600)}catch(e){showError(e.message)}}
function addPortfolioCoin(){const id=$("portfolioCoinSelect").value,c=coinById(id);if(!c||state.portfolio.holdings.some(h=>sameCoinIdentity(h.id,id))||state.portfolio.holdings.length>=30)return;const drafts=portfolioDraft();state.portfolio.holdings=[...drafts,{id:c.id,symbol:c.symbol.toUpperCase(),amount:0,avgCost:0}];clearCatalogPicker("portfolio",false);syncPlanTargets();renderPortfolio();renderPlan()}
async function removePortfolioCoin(id){if(!confirm("Rimuovere questa posizione dal portafoglio? Il Passaporto e lo storico non verranno eliminati."))return;try{state.portfolio=await persistPortfolio(portfolioDraft().filter(h=>h.id!==id));syncPlanTargets();if(state.demo)saveLocalData("cryptoRadarPlan",state.plan);renderPortfolio();renderPlan();renderDecisionLab();renderCopilot();renderDataQuality()}catch(e){showError(e.message)}}

function currentCryptoValues(){
  const values={};let total=0;
  (state.portfolio?.holdings||[]).forEach(h=>{const value=num(h.amount)*num(coinById(h.id)?.current_price);values[h.id]=value;total+=value});
  return {values,total};
}
function renderPlan(){
  if(!state.plan)return;const p=state.plan;
  $("planCapital").value=p.totalInvestableCapital||"";$("planMonthly").value=p.monthlyContribution||"";$("planHorizon").value=p.horizonYears;$("planLoss").value=p.maxToleratedLoss;$("planCryptoMax").value=p.maxCryptoAllocation;$("planCoinMax").value=p.maxSingleCoin;$("planSpecMax").value=p.maxSpeculative;$("planLeverage").value=String(p.allowLeverage);
  if(p.monthlyContribution) $("dcaMonthly").value=p.monthlyContribution;
  syncCatalogPicker("dca");
  const current=currentCryptoValues();
  $("targetRows").innerHTML=p.targets.map((t,i)=>{const c=coinById(t.id);const actual=current.total?num(current.values[t.id])/current.total*100:0;return `<tr data-target-index="${i}"><td>${c?coinCell(c):esc(t.symbol)}</td><td>${actual.toFixed(1)}%</td><td><input class="target-input" type="number" min="0" max="100" step="1" value="${t.target||""}" placeholder="0"></td><td class="target-gap">${(num(t.target)-actual).toFixed(1)} p.p.</td></tr>`}).join("");
  document.querySelectorAll("#plan input,#plan select").forEach(input=>{if(!input.closest(".dca-box"))input.oninput=previewPlan});
  previewPlan();
}
function planDraft(){
  const targets=[...document.querySelectorAll("#targetRows tr")].map(row=>{const original=state.plan.targets[num(row.dataset.targetIndex)];return {...original,target:num(row.querySelector(".target-input").value)}});
  return {totalInvestableCapital:num($("planCapital").value),monthlyContribution:num($("planMonthly").value),horizonYears:num($("planHorizon").value),maxToleratedLoss:num($("planLoss").value),maxCryptoAllocation:num($("planCryptoMax").value),maxSingleCoin:num($("planCoinMax").value),maxSpeculative:num($("planSpecMax").value),allowLeverage:$("planLeverage").value==="true",targets};
}
function previewPlan(){
  if(!state.plan)return;
  if(!document.querySelector("#targetRows tr")){
    $("targetTotal").innerHTML=`Aggiungi almeno una posizione nel portafoglio per definire l'allocazione obiettivo.`;
    $("ruleChecks").innerHTML=`<div class="risk-item warn">Il Piano personale non ha ancora crypto da distribuire.</div>`;
    $("nextContribution").innerHTML=`<p class="muted">Dopo aver aggiunto le posizioni, assegna gli obiettivi fino al 100%.</p>`;
    return;
  }
  const p=planDraft(),current=currentCryptoValues();const totalTarget=p.targets.reduce((s,t)=>s+t.target,0);
  $("targetTotal").innerHTML=`Totale obiettivo: <b class="${Math.abs(totalTarget-100)<.01?'positive':'negative'}">${totalTarget.toFixed(0)}%</b>${Math.abs(totalTarget-100)<.01?' · allocazione valida':' · deve essere 100%'}`;
  [...document.querySelectorAll("#targetRows tr")].forEach((row,i)=>{const actual=current.total?num(current.values[p.targets[i].id])/current.total*100:0;row.querySelector(".target-gap").textContent=`${(p.targets[i].target-actual)>=0?'+':''}${(p.targets[i].target-actual).toFixed(1)} p.p.`});
  const checks=[];
  if(Math.abs(totalTarget-100)>.01) checks.push(["danger","L'allocazione obiettivo non totalizza 100%."]);
  else checks.push(["rule-ok","Allocazione obiettivo completa: 100%."]);
  if(p.totalInvestableCapital>0&&p.maxCryptoAllocation>0){const cryptoPct=current.total/p.totalInvestableCapital*100;checks.push([cryptoPct>p.maxCryptoAllocation?"danger":"rule-ok",`Crypto sul capitale investibile: ${cryptoPct.toFixed(1)}% · limite ${p.maxCryptoAllocation.toFixed(0)}%.`])}
  if(current.total&&p.maxSingleCoin>0){const top=p.targets.map(t=>({symbol:t.symbol,pct:num(current.values[t.id])/current.total*100})).sort((a,b)=>b.pct-a.pct)[0];checks.push([top.pct>p.maxSingleCoin?"warn":"rule-ok",`${top.symbol} è la posizione maggiore: ${top.pct.toFixed(1)}% · limite ${p.maxSingleCoin.toFixed(0)}%.`])}
  checks.push([p.allowLeverage?"danger":"rule-ok",p.allowLeverage?"La leva è consentita dal piano: rischio di perdita amplificato.":"Il piano esclude l'utilizzo della leva."]);
  if(current.total&&p.maxToleratedLoss>0) checks.push(["",`Scenario di perdita tollerata: -${fmtEur(current.total*p.maxToleratedLoss/100)} sul portafoglio crypto.`]);
  $("ruleChecks").innerHTML=checks.map(x=>`<div class="risk-item ${x[0]}">${esc(x[1])}</div>`).join("");
  renderNextContribution(p,current,totalTarget);
}
function renderNextContribution(p,current,totalTarget){
  if(Math.abs(totalTarget-100)>.01||p.monthlyContribution<=0){$("nextContribution").innerHTML=`<p class="muted">Completa l'allocazione al 100% e indica il versamento mensile.</p>`;return}
  const deficits=p.targets.map(t=>{const actual=current.total?num(current.values[t.id])/current.total*100:0;return {...t,deficit:Math.max(0,t.target-actual)}});let denominator=deficits.reduce((s,t)=>s+t.deficit,0);
  if(!denominator){denominator=100;deficits.forEach(t=>t.deficit=t.target)}
  $("nextContribution").innerHTML=deficits.filter(t=>t.deficit>0).map(t=>`<div class="contribution-row"><span>${esc(t.symbol)}</span><b>${fmtEur(p.monthlyContribution*t.deficit/denominator)}</b></div>`).join("")||`<p class="muted">Nessuna posizione sotto obiettivo.</p>`;
}
async function savePlan(){try{const draft=planDraft();if(state.demo){saveLocalData("cryptoRadarPlan",draft);state.plan=draft}else state.plan=await api("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft)});renderPlan();renderDecisionLab();renderCopilot();$("savePlan").textContent="Piano salvato ✓";setTimeout(()=>$("savePlan").textContent="Salva piano",1600)}catch(e){showError(e.message)}}
async function runDca(){
  if(!$("dcaCoin").value){showError("Seleziona una crypto per la simulazione DCA.");return}
  const button=$("runDca");button.disabled=true;button.textContent="Calcolo…";$("dcaOutput").innerHTML=`<p class="muted">Recupero dello storico in corso…</p>`;
  try{const result=await api(`/api/dca?id=${encodeURIComponent($("dcaCoin").value)}&months=${num($("dcaMonths").value)}&monthly=${num($("dcaMonthly").value)}`);const difference=result.currentValue-result.lumpValue;$("dcaOutput").innerHTML=`<div class="dca-result"><span>CAPITALE VERSATO</span><b>${fmtEur(result.invested)}</b><small>${result.months} acquisti mensili</small></div><div class="dca-result"><span>VALORE DCA OGGI</span><b class="${pctClass(result.returnPct)}">${fmtEur(result.currentValue)}</b><small>${fmtPct(result.returnPct)} · costo medio ${fmtEur(result.averageCost)}</small></div><div class="dca-result"><span>ACQUISTO IMMEDIATO</span><b class="${pctClass(result.lumpReturnPct)}">${fmtEur(result.lumpValue)}</b><small>${fmtPct(result.lumpReturnPct)} · differenza ${difference>=0?'+':''}${fmtEur(difference)} per il DCA</small></div>`}catch(e){$("dcaOutput").innerHTML=`<div class="risk-item danger">${esc(e.message)}</div>`}finally{button.disabled=false;button.textContent="Calcola"}
}

function renderDecisionLab(){
  syncCatalogPicker("trade");
  ["btc","eth","alt"].forEach(type=>$(type+"Shock").oninput=()=>{updateShockLabels();renderStressTest()});
  updateShockLabels();renderStressTest();renderJournal();
}
function updateShockLabels(){["btc","eth","alt"].forEach(type=>$(type+"ShockLabel").textContent=`${num($(type+"Shock").value).toFixed(0)}%`)}
function analyzeTrade(){
  const c=coinById($("tradeCoin").value);if(!c)return;const amount=num($("tradeAmount").value),action=$("tradeAction").value,portfolio=currentCryptoValues(),currentValue=num(portfolio.values[c.id]);
  let delta=0;if(action==="buy"||action==="rebalance")delta=amount;if(action==="sell")delta=-Math.min(amount,currentValue);const futureTotal=Math.max(0,portfolio.total+delta),futureCoin=Math.max(0,currentValue+delta),futureWeight=futureTotal?futureCoin/futureTotal*100:0,currentWeight=portfolio.total?currentValue/portfolio.total*100:0;
  const items=[];items.push([c._score>=70?"ok":c._score>=52?"warn":"danger",`${c.name}: score ${c._score}/100 · ${reasons(c)} · rischio ${c._risk}.`]);
  if(c._catalogOnly)items.push(["warn","Catalogo esteso CoinMarketCap: lo score usa soltanto i campi disponibili e non include lo storico completo del campione live."]);
  if(action==="watch")items.push(["ok","L'osservazione non modifica il portafoglio."]);else items.push(["",`Peso stimato: ${currentWeight.toFixed(1)}% → ${futureWeight.toFixed(1)}% dopo la decisione.`]);
  if(action==="sell"&&amount>currentValue)items.push(["danger",`L'importo supera il valore attuale stimato della posizione (${fmtEur(currentValue)}).`]);
  const limit=num(state.plan?.maxSingleCoin);if(limit&&futureWeight>limit)items.push(["danger",`Il peso supererebbe il limite personale del ${limit.toFixed(0)}%.`]);else if(limit&&action!=="watch")items.push(["ok",`Il peso rimarrebbe entro il limite personale del ${limit.toFixed(0)}%.`]);
  const target=state.plan?.targets?.find(t=>t.id===c.id);if(target&&target.target>0)items.push([futureWeight>target.target+5?"warn":"",`Obiettivo impostato ${target.target.toFixed(0)}% · scostamento futuro ${(futureWeight-target.target)>=0?'+':''}${(futureWeight-target.target).toFixed(1)} p.p.`]);
  if(["polygon-ecosystem-token","algorand","cardano"].includes(c.id)){const related=(state.portfolio?.holdings||[]).filter(h=>h.amount>0&&["polygon-ecosystem-token","algorand","cardano"].includes(h.id)&&h.id!==c.id);if(related.length)items.push(["warn",`Aumenta l'esposizione al gruppo altcoin infrastrutturali già presente (${related.map(h=>h.symbol).join(", ")}).`])}
  if(change(c,"7d")>15||change(c,"24h")>10)items.push(["warn",`Movimento recente elevato (${fmtPct(change(c,"7d"))} a 7g): controlla il rischio di inseguire il prezzo.`]);
  if(!$("tradeThesis").value.trim())items.push(["warn","Manca una tesi scritta e verificabile."]);if(!$("tradeInvalidation").value.trim())items.push(["warn","Manca una condizione che invalidi la tesi."]);
  const emotion=$("tradeEmotion").value;if(emotion==="fomo"||emotion==="paura")items.push(["danger",`Stato emotivo dichiarato: ${emotion}. Valuta un periodo di attesa prima di agire.`]);
  items.push([$("tradeFollowPlan").checked?"ok":"warn",$("tradeFollowPlan").checked?"Hai dichiarato coerenza con il piano personale.":"La decisione non è ancora stata confermata come coerente con il piano."]);
  $("tradeAnalysis").innerHTML=items.map(x=>`<div class="analysis-item ${x[0]}">${esc(x[1])}</div>`).join("");
}
async function saveDecision(){
  const c=coinById($("tradeCoin").value);if(!c)return;
  const payload={coinId:c.id,symbol:c.symbol,action:$("tradeAction").value,amount:num($("tradeAmount").value),thesis:$("tradeThesis").value,invalidation:$("tradeInvalidation").value,emotion:$("tradeEmotion").value,followedPlan:$("tradeFollowPlan").checked,score:c._score};
  try{const entry=state.demo?{...payload,id:crypto.randomUUID(),createdAt:Math.floor(Date.now()/1000)}:await api("/api/journal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});state.journal.unshift(entry);if(state.demo)saveLocalData("cryptoRadarDecisionJournal",state.journal);renderJournal();renderMonthlyBehavior();$("saveDecision").textContent="Salvato ✓";setTimeout(()=>$("saveDecision").textContent="Salva nel diario",1400)}catch(e){showError(e.message)}
}
function setStressPreset(name){
  const presets={correction:{btc:-15,eth:-20,alt:-30},winter:{btc:-35,eth:-45,alt:-60},alt:{btc:-10,eth:-20,alt:-50}},p=presets[name]||presets.winter;
  $("btcShock").value=p.btc;$("ethShock").value=p.eth;$("altShock").value=p.alt;updateShockLabels();renderStressTest();document.querySelectorAll("[data-stress]").forEach(b=>b.classList.toggle("active",b.dataset.stress===name));
}
function renderStressTest(){
  const positions=(state.portfolio?.holdings||[]).map(h=>{const c=coinById(h.id),value=num(h.amount)*num(c?.current_price),shock=h.id==="bitcoin"?num($("btcShock").value):h.id==="ethereum"?num($("ethShock").value):num($("altShock").value);return {...h,c,value,shock,after:value*(1+shock/100)}}).filter(x=>x.value>0);
  const before=positions.reduce((s,x)=>s+x.value,0),after=positions.reduce((s,x)=>s+x.after,0),loss=before-after,lossPct=before?loss/before*100:0,tolerance=num(state.plan?.maxToleratedLoss);
  $("stressSummary").innerHTML=before?`<div class="dca-result"><span>VALORE ATTUALE</span><b>${fmtEur(before)}</b><small>Posizioni compilate</small></div><div class="dca-result"><span>VALORE SIMULATO</span><b class="negative">${fmtEur(after)}</b><small>${fmtPct(-lossPct)}</small></div><div class="dca-result"><span>PERDITA IPOTETICA</span><b class="negative">−${fmtEur(loss)}</b><small>${tolerance?`${lossPct>tolerance?'oltre':'entro'} la tolleranza del ${tolerance.toFixed(0)}%`:'tolleranza non impostata'}</small></div>`:`<p class="muted">Inserisci le quantità nel portafoglio per eseguire lo stress test.</p>`;
  $("stressRows").innerHTML=positions.map(x=>`<tr><td>${x.c?coinCell(x.c):esc(x.symbol)}</td><td>${fmtEur(x.value)}</td><td class="negative">${x.shock.toFixed(0)}%</td><td>${fmtEur(x.after)}</td><td class="negative">−${fmtEur(x.value-x.after)}</td></tr>`).join("");
}
function actionLabel(action){return ({buy:"Acquisto",sell:"Vendita",watch:"Osservazione",rebalance:"Ribilanciamento"}[action]||action)}
function renderJournal(){
  const entries=state.journal||[],planned=entries.length?entries.filter(e=>e.followedPlan).length/entries.length*100:0,emotional=entries.filter(e=>["fomo","paura"].includes(e.emotion)).length;
  $("journalStats").innerHTML=`<article class="card metric"><span>Decisioni registrate</span><strong>${entries.length}</strong><small>Storico locale</small></article><article class="card metric"><span>Coerenti col piano</span><strong>${planned.toFixed(0)}%</strong><small>Dichiarazione al momento della decisione</small></article><article class="card metric"><span>FOMO o paura</span><strong>${emotional}</strong><small>Decisioni emotive dichiarate</small></article>`;
  $("journalList").innerHTML=entries.map(e=>`<article class="card journal-card"><div class="journal-side"><b>${esc(e.symbol)}</b><span>${actionLabel(e.action)} · ${new Date(e.createdAt*1000).toLocaleDateString("it-IT")}</span><span>${e.amount?fmtEur(e.amount):"nessun importo"}</span></div><div class="journal-body"><h3>${e.thesis?esc(e.thesis):"Tesi non registrata"}</h3>${e.invalidation?`<p><b>Invalidazione:</b> ${esc(e.invalidation)}</p>`:""}<div class="journal-meta"><span class="badge ${e.followedPlan?'basso':'medio'}">${e.followedPlan?'nel piano':'fuori piano'}</span><span class="badge">${esc(e.emotion)}</span><span class="badge">score ${num(e.score)}</span></div></div><button class="journal-delete" data-journal-id="${esc(e.id)}">Elimina</button></article>`).join("")||`<article class="card insight-card"><p class="muted">Nessuna decisione registrata. Usa il controllo sopra e salvala nel diario.</p></article>`;
  document.querySelectorAll(".journal-delete").forEach(button=>button.onclick=()=>deleteJournalEntry(button.dataset.journalId));
}
async function deleteJournalEntry(id){if(!confirm("Eliminare questa voce dal diario?"))return;try{if(!state.demo)await api(`/api/journal?id=${encodeURIComponent(id)}`,{method:"DELETE"});state.journal=state.journal.filter(e=>e.id!==id);if(state.demo)saveLocalData("cryptoRadarDecisionJournal",state.journal);renderJournal();renderMonthlyBehavior()}catch(e){showError(e.message)}}

function renderDiscovery(){
  $("trendingCards").innerHTML=state.trending.slice(0,10).map((item,i)=>{const c=coinById(item.id);return `<article class="card trend-card" ${c?`data-id="${esc(c.id)}"`:""}><img src="${esc(item.small||item.thumb)}" alt=""><b>${esc(item.symbol)}</b><span>${esc(item.name)}</span><span class="trend-rank">#${i+1} nelle ricerche${c?` · score ${c._score}`:""}</span></article>`}).join("")||`<p class="muted">Dati trending non disponibili.</p>`;
  document.querySelectorAll(".trend-card[data-id]").forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
  renderNews();
}
const newsTranslationLoads={};
async function loadTranslations(){
  try{
    const language=window.CryptoRadarI18n?.language()||"it";
    if(!newsTranslationLoads[language])newsTranslationLoads[language]=api(`/api/news-translations?lang=${encodeURIComponent(language)}`);
    const response=await newsTranslationLoads[language];
    if((window.CryptoRadarI18n?.language()||"it")===language){state.translations=response.translations||{};renderNews();window.CryptoRadarI18n?.translateDocument()}
  }catch(error){ /* Il titolo originale resta disponibile. */ }
}
function renderNews(){
  const portfolioTags=new Set(["POL","ALGO","ADA"]);
  const articles=state.news.filter(a=>state.newsFilter==="ALL"||(state.newsFilter==="PORTFOLIO"?a.tags?.some(t=>portfolioTags.has(t)):a.tags?.includes(state.newsFilter)));
  const italianSources=["Criptovaluta.it","BeInCrypto Italia","The Crypto Gateway"];
  const balancedItalianNews=limit=>{
    const buckets=italianSources.map(source=>state.news.filter(article=>article.source===source)),selected=[];
    while(selected.length<limit){
      const round=buckets.map(bucket=>bucket.shift()).filter(Boolean).sort((a,b)=>new Date(b.published)-new Date(a.published));
      if(!round.length)break;
      selected.push(...round.slice(0,limit-selected.length));
    }
    return selected;
  };
  const sourceClass=source=>({"Criptovaluta.it":"source-criptovaluta","BeInCrypto Italia":"source-beincrypto","The Crypto Gateway":"source-crypto-gateway"}[source]||"");
  const newsCard=(a,compact=false)=>{const when=new Date(a.published),validLink=String(a.link).startsWith("https://")?a.link:"#",isItalian=a.sourceLanguage==="it",translated=state.translations[a.title],displayTitle=translated||a.title,date=Number.isNaN(when.valueOf())?"data non disponibile":when.toLocaleString(uiLocale(),compact?{day:"2-digit",month:"short"}:{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});return `<a class="card news-card ${isItalian?'italian-news-card':''} ${sourceClass(a.source)} ${compact?'home-news-card':''}" href="${esc(validLink)}" target="_blank" rel="noopener noreferrer"><div><h3>${esc(displayTitle)}</h3>${!compact&&translated&&translated!==a.title?`<div class="news-original">${esc(a.title)}</div>`:""}<span class="news-meta">${esc(a.source)} · ${date}${compact?"":" · "+(translated?"traduzione automatica":"titolo originale")}</span></div><div class="news-tags">${(a.tags||[]).map(t=>`<span>${esc(t)}</span>`).join("")}</div></a>`};
  const italian=balancedItalianNews(9);
  $("italianNewsList").innerHTML=italian.map(article=>newsCard(article)).join("")||`<div class="card insight-card"><p class="muted">${tr("Le notizie dalle fonti italiane sono momentaneamente non disponibili.")}</p></div>`;
  $("newsList").innerHTML=articles.slice(0,30).map(article=>newsCard(article)).join("")||`<div class="card insight-card"><p class="muted">Nessuna notizia corrisponde al filtro selezionato.</p></div>`;
  $("homeItalianNewsList").innerHTML=italian.slice(0,4).map(article=>newsCard(article,true)).join("")||`<div class="card insight-card home-news-unavailable"><p class="muted">${tr("Le notizie dalle fonti italiane sono momentaneamente non disponibili.")}</p></div>`;
}

function preferredChartType(){try{return localStorage.getItem("cryptoRadarChartType")==="candles"?"candles":"line"}catch{return"line"}}
const detailChartState={coin:null,range:"365",type:preferredChartType(),history:null,rows:[],currency:"EUR",requestId:0,width:1000,height:420};
const detailRangeLabels={"1h":"1 ora","2h":"2 ore","4h":"4 ore","1":"24 ore","7":"7 giorni","30":"1 mese","90":"3 mesi","365":"1 anno",max:"storico massimo"};
const detailCandleBuckets={"1h":10*60e3,"2h":15*60e3,"4h":30*60e3,"1":60*60e3,"7":6*60*60e3,"30":24*60*60e3,"90":3*24*60*60e3,"365":7*24*60*60e3};
function chartMoney(value,currency=detailChartState.currency,compact=false){
  const amount=num(value),absolute=Math.abs(amount),digits=absolute>=1000?2:absolute>=1?4:absolute>=.01?6:8;
  return new Intl.NumberFormat(uiLocale(),{style:"currency",currency:currency||"EUR",notation:compact?"compact":"standard",maximumFractionDigits:compact?2:digits}).format(amount);
}
function chartPercent(value){
  const amount=num(value),absolute=Math.abs(amount);
  if(absolute<10000)return fmtPct(amount);
  return `${amount>=0?"+":"−"}${new Intl.NumberFormat(uiLocale(),{notation:"compact",maximumFractionDigits:2}).format(absolute)}%`;
}
function chartDate(timestamp,range=detailChartState.range,full=false){
  const date=new Date(num(timestamp));
  const intraday=["1h","2h","4h","1"].includes(range);
  const options=intraday?{day:full?"2-digit":undefined,month:full?"short":undefined,hour:"2-digit",minute:"2-digit"}:range==="7"?{weekday:full?"short":undefined,day:"2-digit",month:"short",hour:full?"2-digit":undefined,minute:full?"2-digit":undefined}:range==="30"||range==="90"?{day:"2-digit",month:"short",year:full?"numeric":undefined}:{month:"short",year:"numeric",day:full?"2-digit":undefined};
  return new Intl.DateTimeFormat(uiLocale(),options).format(date);
}
function chartSeriesValue(series,timestamp){
  if(!Array.isArray(series)||!series.length)return 0;
  let closest=series[0],distance=Math.abs(num(closest[0])-timestamp);
  for(const item of series){const next=Math.abs(num(item?.[0])-timestamp);if(next>=distance)continue;closest=item;distance=next}
  return num(closest?.[1]);
}
function normalizeChartRows(history){
  const prices=(history.prices||[]).map(item=>[num(item?.[0]),num(item?.[1])]).filter(item=>item[0]>0&&item[1]>0).sort((a,b)=>a[0]-b[0]);
  const step=Math.max(1,Math.ceil(prices.length/700)),sampled=prices.filter((_,index)=>index%step===0||index===prices.length-1);
  return sampled.map(([timestamp,price])=>({timestamp,price,volume:chartSeriesValue(history.total_volumes,timestamp),marketCap:chartSeriesValue(history.market_caps,timestamp)}));
}
function normalizeCandleRows(history){
  const prices=(history.prices||[]).map(item=>[num(item?.[0]),num(item?.[1])]).filter(item=>item[0]>0&&item[1]>0).sort((a,b)=>a[0]-b[0]);
  if(prices.length<2)return[];
  const span=prices.at(-1)[0]-prices[0][0],bucketMs=detailCandleBuckets[detailChartState.range]||Math.max(24*60*60e3,Math.ceil(span/80/(24*60*60e3))*24*60*60e3);
  const candles=[];
  for(const [timestamp,price] of prices){
    const bucket=Math.floor(timestamp/bucketMs);
    let candle=candles.at(-1);
    if(!candle||candle.bucket!==bucket){
      candle={bucket,timestamp,open:price,high:price,low:price,close:price};
      candles.push(candle);
    }else{
      candle.timestamp=timestamp;candle.high=Math.max(candle.high,price);candle.low=Math.min(candle.low,price);candle.close=price;
    }
  }
  return candles.map(candle=>({...candle,price:candle.close,volume:chartSeriesValue(history.total_volumes,candle.timestamp),marketCap:chartSeriesValue(history.market_caps,candle.timestamp)}));
}
function chartStartPrice(){const first=detailChartState.rows[0];return num(first?.open||first?.price)}
function setChartQuote(row,index=detailChartState.rows.length-1){
  if(!row)return;
  const firstPrice=chartStartPrice(),changePct=firstPrice?(row.price/firstPrice-1)*100:0;
  $("detailChartPrice").textContent=chartMoney(row.price);
  $("detailChartChange").textContent=chartPercent(changePct);
  $("detailChartChange").className=changePct>=0?"positive":"negative";
  $("detailChartTimestamp").textContent=`${chartDate(row.timestamp,detailChartState.range,true)} · ${tr(detailRangeLabels[detailChartState.range])}`;
}
function resetChartHover(){
  $("detailChartHover")?.setAttribute("visibility","hidden");
  $("detailChartTooltip").classList.add("hidden");
  setChartQuote(detailChartState.rows.at(-1));
}
function showChartPoint(index){
  const row=detailChartState.rows[index],svg=$("priceChart"),stage=$("priceChartStage"),tooltip=$("detailChartTooltip");
  if(!row||!svg||!stage)return;
  const x=num(row.x),y=num(row.y),hover=$("detailChartHover"),crosshair=$("detailChartCrosshair"),dot=$("detailChartDot");
  hover?.setAttribute("visibility","visible");crosshair?.setAttribute("x1",x);crosshair?.setAttribute("x2",x);
  dot?.setAttribute("cx",x);dot?.setAttribute("cy",y);
  const firstPrice=chartStartPrice(),periodChange=firstPrice?(row.price/firstPrice-1)*100:0;
  const candleValues=row.open?`<div class="market-chart-ohlc"><div><span>${tr("Apertura")}</span><b>${chartMoney(row.open)}</b></div><div><span>${tr("Massimo")}</span><b>${chartMoney(row.high)}</b></div><div><span>${tr("Minimo")}</span><b>${chartMoney(row.low)}</b></div><div><span>${tr("Chiusura")}</span><b>${chartMoney(row.close)}</b></div></div>`:"";
  tooltip.innerHTML=`<b>${chartMoney(row.price)}</b><span>${esc(chartDate(row.timestamp,detailChartState.range,true))}</span>${candleValues}<small class="market-chart-tooltip-meta">${tr("Variazione periodo")}: ${chartPercent(periodChange)}${row.volume?` · ${tr("Volume 24h")}: ${chartMoney(row.volume,detailChartState.currency,true)}`:""}</small>`;
  tooltip.classList.remove("hidden");
  const stageRect=stage.getBoundingClientRect(),left=x/detailChartState.width*stageRect.width+12,top=y/detailChartState.height*stageRect.height-18;
  tooltip.style.left=`${clamp(left,8,Math.max(8,stageRect.width-tooltip.offsetWidth-8))}px`;
  tooltip.style.top=`${clamp(top,8,Math.max(8,stageRect.height-tooltip.offsetHeight-8))}px`;
  setChartQuote(row,index);
}
function drawChart(history){
  const svg=$("priceChart"),candles=detailChartState.type==="candles",rows=candles?normalizeCandleRows(history):normalizeChartRows(history);
  detailChartState.rows=rows;detailChartState.currency=history.currency||"EUR";
  if(rows.length<2){svg.innerHTML="";throw new Error("Lo storico disponibile non contiene abbastanza punti per disegnare il grafico.")}
  const width=Math.max(320,Math.round(svg.clientWidth||1000)),height=Math.max(300,Math.round(svg.clientHeight||420)),compact=width<600,left=compact?9:20,right=width-(compact?47:88),top=24,priceBottom=height-104,volumeTop=height-78,volumeBottom=height-40,axisBottom=height-12;
  detailChartState.width=width;detailChartState.height=height;svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
  const minimums=rows.map(row=>candles?row.low:row.price),maximums=rows.map(row=>candles?row.high:row.price),rawMin=Math.min(...minimums),rawMax=Math.max(...maximums),rawRange=rawMax-rawMin||Math.max(rawMax*.02,1),min=Math.max(0,rawMin-rawRange*.08),max=rawMax+rawRange*.08,priceRange=max-min||1;
  const volumes=rows.map(row=>row.volume),maxVolume=Math.max(...volumes,1),xFor=index=>left+index/(rows.length-1)*(right-left),yFor=value=>top+(max-value)/priceRange*(priceBottom-top);
  rows.forEach((row,index)=>{row.x=xFor(index);row.y=yFor(row.price)});
  const line=rows.map((row,index)=>`${index?"L":"M"}${row.x.toFixed(2)},${row.y.toFixed(2)}`).join(" "),area=`${line} L${right},${priceBottom} L${left},${priceBottom} Z`,positive=rows.at(-1).price>=rows[0].price,color=positive?"#62ddb0":"#ff7185";
  const horizontal=Array.from({length:5},(_,index)=>{const ratio=index/4,y=top+ratio*(priceBottom-top),value=max-ratio*priceRange;return `<line class="market-chart-grid" x1="${left}" y1="${y}" x2="${right}" y2="${y}"/><text class="market-chart-axis" x="${right+12}" y="${y+4}">${esc(chartMoney(value,detailChartState.currency,true))}</text>`}).join("");
  const labelIndexes=[0,.25,.5,.75,1].map(ratio=>Math.round((rows.length-1)*ratio)),vertical=labelIndexes.map((rowIndex,index)=>{const row=rows[rowIndex],anchor=index===0?"start":index===labelIndexes.length-1?"end":"middle";return `<line class="market-chart-grid" x1="${row.x}" y1="${top}" x2="${row.x}" y2="${volumeBottom}"/><text class="market-chart-axis" x="${row.x}" y="${axisBottom}" text-anchor="${anchor}">${esc(chartDate(row.timestamp))}</text>`}).join("");
  const barWidth=Math.max(1,Math.min(5,(right-left)/rows.length*.62)),volumeBars=rows.map(row=>{const barHeight=row.volume/maxVolume*(volumeBottom-volumeTop);return `<rect class="market-chart-volume" x="${(row.x-barWidth/2).toFixed(2)}" y="${(volumeBottom-barHeight).toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}"/>`}).join("");
  const candleWidth=Math.max(3,Math.min(14,(right-left)/rows.length*.58)),candleShapes=candles?rows.map(row=>{const openY=yFor(row.open),closeY=yFor(row.close),highY=yFor(row.high),lowY=yFor(row.low),direction=row.close>=row.open?"up":"down",bodyHeight=Math.max(1,Math.abs(closeY-openY)),bodyY=Math.min(openY,closeY)-(bodyHeight===1?.5:0);return `<line class="market-chart-candle-wick ${direction}" x1="${row.x.toFixed(2)}" y1="${highY.toFixed(2)}" x2="${row.x.toFixed(2)}" y2="${lowY.toFixed(2)}"/><rect class="market-chart-candle-body ${direction}" x="${(row.x-candleWidth/2).toFixed(2)}" y="${bodyY.toFixed(2)}" width="${candleWidth.toFixed(2)}" height="${bodyHeight.toFixed(2)}" rx="1"/>`}).join(""):"";
  const priceVisual=candles?`<g>${candleShapes}</g>`:`<path class="market-chart-area" fill="url(#detailChartGradient)" d="${area}"/><path class="market-chart-line" stroke="${color}" d="${line}"/>`,hoverDot=candles?"":`<circle id="detailChartDot" class="market-chart-dot" cx="${right}" cy="${rows.at(-1).y}" r="5" fill="${color}"/>`;
  svg.style.color=color;
  svg.innerHTML=`<defs><linearGradient id="detailChartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".55"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>${horizontal}${vertical}<g style="color:${color}">${volumeBars}</g>${priceVisual}<g id="detailChartHover" visibility="hidden"><line id="detailChartCrosshair" class="market-chart-crosshair" x1="${right}" y1="${top}" x2="${right}" y2="${volumeBottom}"/>${hoverDot}</g><rect class="market-chart-hit" x="${left}" y="${top}" width="${right-left}" height="${volumeBottom-top}"/>`;
  svg.onpointermove=event=>{const rect=svg.getBoundingClientRect(),chartX=(event.clientX-rect.left)/rect.width*width,index=Math.round(clamp((chartX-left)/(right-left),0,1)*(rows.length-1));showChartPoint(index)};
  svg.onpointerleave=resetChartHover;
  svg.onpointerdown=event=>{event.preventDefault();svg.setPointerCapture?.(event.pointerId)};
  const latest=rows.at(-1),latestVolume=latest.volume,conversion=history.conversion==="current-rate"?` · ${tr("conversione EUR indicativa al cambio corrente")}`:"";
  const candleNote=candles?`${tr("Candele aggregate dai punti di mercato")} · `:"";
  $("detailChartSummary").textContent=`${candleNote}${tr("Min")}: ${chartMoney(rawMin)} · ${tr("Max")}: ${chartMoney(rawMax)}${latestVolume?` · ${tr("Volume 24h")}: ${chartMoney(latestVolume,detailChartState.currency,true)}`:""}${conversion}`;
  $("detailChartSource").textContent=`${tr("Fonte")} ${history.source||"mercato"} ↗`;
  $("detailChartSource").href=String(history.sourceUrl||"https://coinmarketcap.com/").startsWith("https://")?history.sourceUrl:"https://coinmarketcap.com/";
  setChartQuote(latest);
}
function syncDetailChartType(){
  document.querySelectorAll("[data-chart-type]").forEach(button=>{const active=button.dataset.chartType===detailChartState.type;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active))});
}
function setDetailChartType(type){
  if(!["line","candles"].includes(type))return;
  detailChartState.type=type;syncDetailChartType();
  try{localStorage.setItem("cryptoRadarChartType",type)}catch{/* La preferenza resta valida per la sessione. */}
  if(detailChartState.history)drawChart(detailChartState.history);
}
let detailChartResizeTimer=0;
if(window.ResizeObserver){
  new ResizeObserver(()=>{if(!detailChartState.history)return;clearTimeout(detailChartResizeTimer);detailChartResizeTimer=setTimeout(()=>drawChart(detailChartState.history),120)}).observe($("priceChartStage"));
}
async function loadDetailHistory(range=detailChartState.range){
  const coin=detailChartState.coin;if(!coin)return;
  detailChartState.range=range;
  document.querySelectorAll("[data-chart-range]").forEach(button=>button.classList.toggle("active",button.dataset.chartRange===range));
  const requestId=++detailChartState.requestId,loading=$("detailChartLoading");
  loading.textContent=tr("Caricamento del grafico…");loading.classList.remove("hidden");$("detailChartTooltip").classList.add("hidden");
  try{
    const cmcId=(coin.cmcId||String(coin.id).startsWith("cmc-"))?String(coin.cmcId||coin.id.slice(4)):"";
    const history=await api(`/api/history?id=${encodeURIComponent(coin.id)}&range=${encodeURIComponent(range)}${cmcId?`&cmcId=${encodeURIComponent(cmcId)}`:""}`);
    if(requestId!==detailChartState.requestId)return;
    detailChartState.history=history;drawChart(history);loading.classList.add("hidden");
  }catch(error){
    if(requestId!==detailChartState.requestId)return;
    $("priceChart").innerHTML="";detailChartState.history=null;detailChartState.rows=[];$("detailChartPrice").textContent="—";$("detailChartChange").textContent="—";$("detailChartTimestamp").textContent=tr("Storico non disponibile");
    $("detailChartSummary").textContent=tr("Prova un altro intervallo o ripeti più tardi.");
    loading.textContent=error.message||tr("Grafico non disponibile per questa crypto.");
  }
}
async function openDetail(id){
  const c=coinById(id);if(!c)return;
  detailChartState.coin=c;detailChartState.history=null;syncDetailChartType();showPage("detail",c.name);$("detailTitle").textContent=`${c.name} (${c.symbol.toUpperCase()})`;$("detailScore").textContent=c._score;
  $("detailIdentity").textContent=`Rank #${num(c.market_cap_rank)||"—"} · ${tr("Prezzo attuale")} ${fmtEur(c.current_price)} · ${tr("Capitalizzazione")} ${fmtEur(c.market_cap,true)}`;
  $("detailMetrics").innerHTML=[['Momentum',c._momentum+'/100'],['Liquidità',c._liquidity+'/100'],['Tokenomics',c._tokenomics+'/100'],['Rischio',c._risk]].map(x=>`<article class="card metric"><span>${x[0]}</span><strong>${x[1]}</strong><small>Indicatore quantitativo</small></article>`).join('');
  await loadDetailHistory("365");window.CryptoRadarI18n?.translateDocument();
}
function localData(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function saveLocalData(key,value){localStorage.setItem(key,JSON.stringify(value))}
function activePositions(){return (state.portfolio?.holdings||[]).map(h=>{const coin=coinById(h.id),value=num(h.amount)*num(coin?.current_price);return {...h,coin,value}}).filter(x=>x.value>0)}

function alertSettings(){return {...{dailyMove:8,weeklyMove:18,concentration:35,targetGap:8,news:true},...localData("cryptoRadarAlertSettings",{})}}
function buildSmartAlerts(){
  const settings=alertSettings(),positions=activePositions(),total=positions.reduce((sum,x)=>sum+x.value,0),alerts=[];
  if(!positions.length)alerts.push({level:"ok",title:"Portafoglio non compilato",text:"Inserisci almeno una quantità per attivare gli alert personali.",why:"Il mercato continua a essere monitorato, ma non è possibile calcolare concentrazione o impatto."});
  positions.forEach(p=>{
    const weight=total?p.value/total*100:0,d1=change(p.coin||{},"24h"),d7=change(p.coin||{},"7d");
    if(weight>settings.concentration)alerts.push({level:"danger",title:`Concentrazione ${p.symbol}: ${weight.toFixed(1)}%`,text:`Supera la soglia personale del ${settings.concentration}%.`,why:"Una singola posizione può determinare gran parte del risultato complessivo."});
    if(Math.abs(d1)>=settings.dailyMove)alerts.push({level:"warn",title:`${p.symbol} ${d1>=0?'sale':'scende'} del ${Math.abs(d1).toFixed(1)}% in 24h`,text:"Movimento superiore alla soglia giornaliera.",why:"Verifica volume, notizie e tesi prima di reagire al prezzo."});
    if(Math.abs(d7)>=settings.weeklyMove)alerts.push({level:"warn",title:`${p.symbol}: ${fmtPct(d7)} in 7 giorni`,text:"Variazione settimanale elevata.",why:"Un movimento rapido può modificare il peso della posizione e favorire decisioni emotive."});
    if(num(p.coin?._score)<45)alerts.push({level:"warn",title:`${p.symbol}: score quantitativo debole`,text:`Score attuale ${num(p.coin?._score)}/100.`,why:"Non implica vendita, ma richiede una revisione della tesi e dei rischi specifici."});
  });
  const targets=state.plan?.targets||[];targets.forEach(t=>{const actual=total?num(positions.find(p=>p.id===t.id)?.value)/total*100:0,gap=actual-num(t.target);if(t.target>0&&Math.abs(gap)>=settings.targetGap)alerts.push({level:"warn",title:`${t.symbol}: scostamento ${gap>=0?'+':''}${gap.toFixed(1)} p.p.`,text:`Attuale ${actual.toFixed(1)}% · obiettivo ${num(t.target).toFixed(1)}%.`,why:"Controlla il ribilanciamento con il prossimo versamento, senza automatizzare una vendita."})});
  if(settings.news&&positions.length){const symbols=new Set(positions.map(p=>p.symbol)),since=Date.now()-36*3600e3,relevant=state.news.filter(a=>new Date(a.published).valueOf()>=since&&(a.tags||[]).some(t=>symbols.has(t)));if(relevant.length)alerts.push({level:"ok",title:`${relevant.length} notizie recenti sul portafoglio`,text:"Sono disponibili nuovi elementi di contesto.",why:"Leggi la fonte originale e separa i fatti dalle interpretazioni."})}
  if(!alerts.some(a=>a.level==="danger")&&positions.length)alerts.push({level:"ok",title:"Nessuna soglia critica superata",text:"I controlli configurati non mostrano criticità immediate.",why:"Assenza di alert non significa assenza di rischio."});
  return alerts;
}
function renderAlerts(){
  const s=alertSettings();$("alertDailyMove").value=s.dailyMove;$("alertWeeklyMove").value=s.weeklyMove;$("alertConcentration").value=s.concentration;$("alertTargetGap").value=s.targetGap;$("alertNews").checked=s.news;
  const alerts=buildSmartAlerts();$("alertCount").textContent=`${alerts.length} controlli attivi`;$("smartAlerts").innerHTML=alerts.map(a=>`<article class="smart-alert ${a.level}"><div><b>${esc(a.title)}</b><span>${esc(a.text)}</span><small>${esc(a.why)}</small></div></article>`).join("");
}
function saveAlertSettings(){saveLocalData("cryptoRadarAlertSettings",{dailyMove:clamp(num($("alertDailyMove").value),1,100),weeklyMove:clamp(num($("alertWeeklyMove").value),1,200),concentration:clamp(num($("alertConcentration").value),1,100),targetGap:clamp(num($("alertTargetGap").value),1,100),news:$("alertNews").checked});renderAlerts()}

function weeklyCalculations(){
  const positions=activePositions(),current=positions.reduce((s,p)=>s+p.value,0);let previous=0;
  const contributions=positions.map(p=>{const d7=change(p.coin||{},"7d"),base=d7>-99?p.value/(1+d7/100):p.value,impact=p.value-base;previous+=base;return {...p,d7,base,impact}}).sort((a,b)=>Math.abs(b.impact)-Math.abs(a.impact));
  return {positions,current,previous,change:current-previous,changePct:previous?(current/previous-1)*100:0,contributions};
}
function renderWeeklyReport(){
  const w=weeklyCalculations(),alerts=buildSmartAlerts(),critical=alerts.filter(a=>a.level==="danger").length,warnings=alerts.filter(a=>a.level==="warn").length,compliance=clamp(100-critical*20-warnings*7),snapshots=localData("cryptoRadarWeeklySnapshots",[]),latest=snapshots[0],periodChange=latest?w.current-num(latest.value):w.change,periodPct=latest&&num(latest.value)?periodChange/num(latest.value)*100:w.changePct,periodLabel=latest?`Dalla fotografia del ${new Date(latest.date).toLocaleDateString("it-IT")}`:"Stima ricostruita a 7 giorni";
  $("weeklyReportMeta").textContent=`Generato ${new Date().toLocaleString("it-IT")} · ${periodLabel}`;
  $("weeklyReportMetrics").innerHTML=`<article class="card metric"><span>Valore attuale</span><strong>${fmtEur(w.current)}</strong><small>Posizioni compilate</small></article><article class="card metric"><span>Variazione periodo</span><strong class="${pctClass(periodChange)}">${fmtEur(periodChange)}</strong><small>${fmtPct(periodPct)} · ${periodLabel}</small></article><article class="card metric"><span>Coerenza controlli</span><strong>${compliance.toFixed(0)}/100</strong><small>${critical} critici · ${warnings} da rivedere</small></article>`;
  const max=Math.max(1,...w.contributions.map(x=>Math.abs(x.impact)));$("weeklyContributors").innerHTML=w.contributions.map(x=>`<div class="contributor-row"><b>${esc(x.symbol)}</b><div class="bar-track"><div class="bar-fill" style="width:${Math.abs(x.impact)/max*100}%"></div></div><span class="${pctClass(x.impact)}">${x.impact>=0?'+':''}${fmtEur(x.impact)}</span></div>`).join("")||`<p class="muted">Compila il portafoglio per calcolare i contributi.</p>`;
  $("weeklyActions").innerHTML=alerts.filter(a=>a.level!=="ok").slice(0,6).map(a=>`<div class="risk-item ${a.level}">${esc(a.title)} · ${esc(a.why)}</div>`).join("")||`<div class="risk-item rule-ok">Nessuna soglia da rivedere; controlla comunque tesi e fonti.</div>`;renderSnapshots();
}
function saveWeeklySnapshot(){const w=weeklyCalculations(),list=localData("cryptoRadarWeeklySnapshots",[]);list.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),value:w.current,cost:activePositions().reduce((s,p)=>s+num(p.amount)*num(p.avgCost),0),positions:w.positions.length});saveLocalData("cryptoRadarWeeklySnapshots",list.slice(0,52));renderSnapshots()}
function renderSnapshots(){const list=localData("cryptoRadarWeeklySnapshots",[]);$("weeklySnapshots").innerHTML=list.map(s=>`<div class="snapshot-item"><b>${new Date(s.date).toLocaleDateString("it-IT")}</b><span>Valore ${fmtEur(s.value)}</span><span>Costo ${fmtEur(s.cost)}</span><span>${s.positions} posizioni</span><button class="journal-delete delete-snapshot" data-id="${esc(s.id)}">Elimina</button></div>`).join("")||`<p class="muted">Salva una fotografia ogni settimana per creare uno storico reale.</p>`;document.querySelectorAll('.delete-snapshot').forEach(b=>b.onclick=()=>{saveLocalData("cryptoRadarWeeklySnapshots",list.filter(x=>x.id!==b.dataset.id));renderSnapshots()})}

function paperState(){return {...{initialCash:10000,cash:10000,positions:{},trades:[]},...localData("cryptoRadarPaper",{})}}
function savePaper(data){saveLocalData("cryptoRadarPaper",data);renderPaper()}
function renderPaper(){
  if(!state.scored.length)return;const paper=paperState();syncCatalogPicker("paper");
  const rows=Object.entries(paper.positions).map(([id,p])=>{const coin=coinById(id),value=num(p.quantity)*num(coin?.current_price),cost=num(p.quantity)*num(p.avgCost);return {id,...p,coin,value,pnl:value-cost}}).filter(x=>x.quantity>1e-12);const invested=rows.reduce((s,x)=>s+x.value,0),total=paper.cash+invested,pnl=total-paper.initialCash;
  $("paperMetrics").innerHTML=`<article class="card metric"><span>Valore virtuale</span><strong>${fmtEur(total)}</strong><small>Capitale iniziale ${fmtEur(paper.initialCash)}</small></article><article class="card metric"><span>Liquidità</span><strong>${fmtEur(paper.cash)}</strong><small>Disponibile per simulazioni</small></article><article class="card metric"><span>Risultato</span><strong class="${pctClass(pnl)}">${fmtEur(pnl)}</strong><small>${fmtPct(paper.initialCash?pnl/paper.initialCash*100:0)}</small></article>`;
  $("paperPositions").innerHTML=rows.map(x=>`<tr><td>${esc(x.coin?.symbol?.toUpperCase()||x.id)}</td><td>${num(x.quantity).toFixed(6)}</td><td>${fmtEur(x.avgCost)}</td><td>${fmtEur(x.value)}</td><td class="${pctClass(x.pnl)}">${fmtEur(x.pnl)}</td></tr>`).join("")||`<tr><td colspan="5" class="muted">Nessuna posizione virtuale.</td></tr>`;
  $("paperLedger").innerHTML=(paper.trades||[]).slice(0,50).map(t=>`<div class="paper-trade"><b>${new Date(t.date).toLocaleDateString("it-IT")}</b><span>${t.action==="buy"?'Acquisto':'Vendita'}</span><strong>${esc(t.symbol)}</strong><span>${fmtEur(t.amount)} · ${num(t.quantity).toFixed(6)}</span><small>fee ${fmtEur(t.fee)}</small></div>`).join("")||`<p class="muted">Nessuna operazione simulata.</p>`;updatePaperPreview();
}
function updatePaperPreview(){if(!$("paperOrderPreview"))return;const c=coinById($("paperCoin").value),amount=num($("paperAmount").value),fee=amount*num($("paperFee").value)/100;if(!c||!num(c.current_price)){$("paperOrderPreview").textContent="Cerca e seleziona una crypto per preparare l’operazione virtuale.";return}$("paperOrderPreview").textContent=`Prezzo indicativo ${fmtEur(c.current_price)} · quantità ${(amount/c.current_price).toFixed(6)} · commissione ${fmtEur(fee)}`}
function executePaper(){
  const paper=paperState(),coin=coinById($("paperCoin").value),action=$("paperAction").value,amount=num($("paperAmount").value),fee=amount*clamp(num($("paperFee").value),0,10)/100;if(!coin||amount<=0)return showError("Importo simulato non valido.");const qty=amount/coin.current_price,positionId=Object.keys(paper.positions).find(id=>sameCoinIdentity(id,coin.id))||coin.id,pos=paper.positions[positionId]||{quantity:0,avgCost:0};
  if(action==="buy"){if(paper.cash<amount+fee)return showError("Liquidità virtuale insufficiente.");const newQty=pos.quantity+qty;pos.avgCost=(pos.quantity*pos.avgCost+amount+fee)/newQty;pos.quantity=newQty;paper.cash-=amount+fee}else{if(pos.quantity+1e-12<qty)return showError("Quantità virtuale insufficiente.");pos.quantity-=qty;paper.cash+=amount-fee;if(pos.quantity<1e-12)delete paper.positions[positionId]}
  if(pos.quantity>=1e-12)paper.positions[positionId]=pos;paper.trades.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),action,symbol:coin.symbol.toUpperCase(),coinId:positionId,amount,quantity:qty,price:coin.current_price,fee});savePaper(paper);
}
function resetPaper(){if(!confirm("Azzerare tutte le operazioni virtuali?"))return;savePaper({initialCash:10000,cash:10000,positions:{},trades:[]})}

function calendarState(){return {...{routines:{dcaDay:5,weeklyReview:true},events:[]},...localData("cryptoRadarCalendar",{})}}
function localIsoDate(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`}
function automaticCalendarEvents(routines){const result=[],today=new Date();today.setHours(0,0,0,0);const end=new Date(today);end.setDate(end.getDate()+90);for(let cursor=new Date(today);cursor<=end;cursor.setDate(cursor.getDate()+1)){if(routines.weeklyReview&&cursor.getDay()===0)result.push({id:`auto-review-${localIsoDate(cursor)}`,date:localIsoDate(cursor),title:"Revisione settimanale del portafoglio",type:"review",asset:"PORTAFOGLIO",notes:"Controlla piano, alert, tesi e decisioni.",automatic:true});if(cursor.getDate()===num(routines.dcaDay))result.push({id:`auto-dca-${localIsoDate(cursor)}`,date:localIsoDate(cursor),title:"Promemoria versamento DCA",type:"dca",asset:"PIANO",notes:`Budget previsto: ${fmtEur(state.plan?.monthlyContribution||0)}. Verifica prima la disponibilità finanziaria.`,automatic:true})}return result}
function renderCalendar(){const cal=calendarState();$("calendarDcaDay").value=cal.routines.dcaDay;$("calendarWeeklyReview").checked=cal.routines.weeklyReview;if(!$("calendarDate").value){const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);$("calendarDate").value=localIsoDate(tomorrow)}const today=localIsoDate(new Date()),limit=new Date();limit.setDate(limit.getDate()+90);const events=[...(cal.events||[]),...automaticCalendarEvents(cal.routines)].filter(e=>e.date>=today&&e.date<=localIsoDate(limit)).sort((a,b)=>a.date.localeCompare(b.date));$("calendarCount").textContent=`${events.length} eventi`;$("calendarEvents").innerHTML=events.map(e=>{const d=new Date(`${e.date}T12:00:00`);return `<article class="calendar-event" data-type="${esc(e.type)}"><div class="calendar-date">${d.getDate()}<span>${d.toLocaleDateString("it-IT",{month:"short"})}</span></div><div class="calendar-dot"></div><div><b>${esc(e.title)}</b><span>${esc(e.asset||"")} · ${esc(e.type)}</span>${e.notes?`<small>${esc(e.notes)}</small>`:""}</div>${e.automatic?`<span class="badge">routine</span>`:`<button class="journal-delete delete-calendar" data-id="${esc(e.id)}">Elimina</button>`}</article>`}).join("")||`<div class="card insight-card"><p class="muted">Nessun evento nei prossimi 90 giorni.</p></div>`;document.querySelectorAll('.delete-calendar').forEach(b=>b.onclick=()=>{cal.events=cal.events.filter(e=>e.id!==b.dataset.id);saveLocalData("cryptoRadarCalendar",cal);renderCalendar()})}
function addCalendarEvent(){const title=$("calendarTitle").value.trim(),date=$("calendarDate").value;if(!title||!date)return showError("Titolo e data dell'evento sono obbligatori.");const cal=calendarState();cal.events.push({id:crypto.randomUUID(),title:title.slice(0,120),date,type:$("calendarType").value,asset:$("calendarAsset").value.trim().toUpperCase().slice(0,20),notes:$("calendarNotes").value.trim().slice(0,500)});saveLocalData("cryptoRadarCalendar",cal);$("calendarTitle").value="";$("calendarAsset").value="";$("calendarNotes").value="";renderCalendar()}
function saveCalendarRoutines(){const cal=calendarState();cal.routines={dcaDay:clamp(Math.round(num($("calendarDcaDay").value)),1,28),weeklyReview:$("calendarWeeklyReview").checked};saveLocalData("cryptoRadarCalendar",cal);renderCalendar()}
function exportCalendar(){const cal=calendarState(),events=[...(cal.events||[]),...automaticCalendarEvents(cal.routines)],escapeIcs=x=>String(x||"").replace(/\\/g,"\\\\").replace(/\n/g,"\\n").replace(/[,;]/g,m=>`\\${m}`),lines=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Crypto Radar//IT"];events.forEach(e=>{lines.push("BEGIN:VEVENT",`UID:${escapeIcs(e.id)}@crypto-radar`,`DTSTART;VALUE=DATE:${e.date.replaceAll("-","")}`,`SUMMARY:${escapeIcs(e.title)}`,`DESCRIPTION:${escapeIcs(`${e.asset||""} ${e.notes||""}`.trim())}`,"END:VEVENT")});lines.push("END:VCALENDAR");const url=URL.createObjectURL(new Blob([lines.join("\r\n")],{type:"text/calendar;charset=utf-8"})),a=document.createElement("a");a.href=url;a.download="crypto-radar-calendario.ics";a.click();URL.revokeObjectURL(url)}

let currentCopilotResult=null;
const copilotStore={passports:"cryptoRadarPassports",fiscal:"cryptoRadarFiscalReadiness",scores:"cryptoRadarScoreSnapshot",security:"cryptoRadarSecurityHistory",profile:"cryptoRadarLocalProfile"};
function downloadBlob(filename,content,type="application/json;charset=utf-8"){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement("a");a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
function copilotUniverse(){const preferred=new Set([...pinnedIds(),...(state.portfolio?.holdings||[]).map(h=>h.id),"bitcoin","ethereum"]);return state.scored.filter(c=>preferred.has(c.id)||eligible(c)).slice(0,150)}
function renderCopilotSelector(){if(!state.scored.length)return;syncCatalogPicker("copilot")}
function taxReadinessState(){return {...{checks:{},totalTx:0,unmatched:0,missingCost:0,unclassified:0,notes:"",updatedAt:null},...localData(copilotStore.fiscal,{})}}
function taxReadinessCalculation(data=taxReadinessState()){const checks=Object.values(data.checks||{}).filter(Boolean).length,checkScore=checks/10*60,total=Math.max(0,num(data.totalTx)),issues=Math.max(0,num(data.unmatched))+Math.max(0,num(data.missingCost))+Math.max(0,num(data.unclassified)),quality=total?clamp(1-issues/Math.max(total,1),0,1)*30:0,inventory=total>0?10:0;return {score:Math.round(checkScore+quality+inventory),checks,issues,total}}
function renderFiscalReadiness(){const data=taxReadinessState(),calc=taxReadinessCalculation(data);$("fiscalTotalTx").value=data.totalTx||"";$("fiscalUnmatched").value=data.unmatched||"";$("fiscalMissingCost").value=data.missingCost||"";$("fiscalUnclassified").value=data.unclassified||"";$("fiscalNotes").value=data.notes||"";document.querySelectorAll("[data-fiscal-ready]").forEach(x=>x.checked=Boolean(data.checks?.[x.dataset.fiscalReady]));$("taxReadinessScore").textContent=`${calc.score}%`;$("taxReadinessLabel").textContent=calc.score>=85?"quasi pronto":calc.score>=60?"da completare":"lacune importanti";$("taxReadinessRing").style.setProperty("--readiness",`${calc.score*3.6}deg`);$("taxReadinessRing").innerHTML=`<b>${calc.score}%</b>`;$("taxReadinessTitle").textContent=calc.score>=85?"Fascicolo ben preparato":calc.score>=60?"Preparazione intermedia":"Preparazione incompleta";$("taxReadinessAdvice").textContent=calc.issues?`${calc.issues} anomalie dichiarate richiedono riconciliazione.`:calc.total?"Nessuna anomalia numerica dichiarata; completa comunque tutti i controlli.":"Registra il totale delle transazioni e completa la checklist.";const gaps=[];if(!calc.total)gaps.push("Inserisci il totale delle transazioni dell’anno.");if(data.unmatched)gaps.push(`${data.unmatched} trasferimenti non sono ancora abbinati.`);if(data.missingCost)gaps.push(`${data.missingCost} operazioni non hanno un costo documentato.`);if(data.unclassified)gaps.push(`${data.unclassified} eventi richiedono classificazione fiscale.`);document.querySelectorAll("[data-fiscal-ready]").forEach(x=>{if(!x.checked)gaps.push(x.parentElement.textContent.trim())});$("fiscalGaps").innerHTML=gaps.slice(0,12).map(x=>`<div class="risk-item ${calc.score<60?'warn':''}">${esc(x)}</div>`).join("")||`<div class="risk-item rule-ok">Tutti i controlli dichiarati risultano completati. Procedi con verifica professionale e istruzioni annuali.</div>`}
function saveFiscalReadiness(){const checks={};document.querySelectorAll("[data-fiscal-ready]").forEach(x=>checks[x.dataset.fiscalReady]=x.checked);saveLocalData(copilotStore.fiscal,{checks,totalTx:Math.max(0,num($("fiscalTotalTx").value)),unmatched:Math.max(0,num($("fiscalUnmatched").value)),missingCost:Math.max(0,num($("fiscalMissingCost").value)),unclassified:Math.max(0,num($("fiscalUnclassified").value)),notes:$("fiscalNotes").value.trim().slice(0,2500),updatedAt:new Date().toISOString()});renderFiscalReadiness();renderBehaviorScore();$("saveFiscalReadiness").textContent="Situazione salvata ✓";setTimeout(()=>$("saveFiscalReadiness").textContent="Salva situazione",1400)}
function sourceLines(){return $("copilotSources").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,12)}
function runCopilot(){const c=coinById($("copilotCoin").value);if(!c)return;const action=$("copilotAction").value,amount=Math.max(0,num($("copilotAmount").value)),fees=clamp(num($("copilotFees").value),0,20),emotion=$("copilotEmotion").value,thesis=$("copilotThesis").value.trim(),invalidation=$("copilotInvalidation").value.trim(),sources=sourceLines(),portfolio=currentCryptoValues(),current=num(portfolio.values[c.id]),direction=action==="buy"?1:action==="sell"?-1:0,projectedCoin=Math.max(0,current+direction*amount),projectedTotal=Math.max(0,portfolio.total+direction*amount),weight=projectedTotal?projectedCoin/projectedTotal*100:0,p=state.plan||{},maxCoin=num(p.maxSingleCoin),capital=num(p.totalInvestableCapital),cryptoAfter=capital?projectedTotal/capital*100:0,scenario=c.id==="bitcoin"?-35:c.id==="ethereum"?-45:-60,scenarioLoss=projectedCoin*Math.abs(scenario)/100,feeCost=amount*fees/100;let quality=100;const findings=[];const add=(level,text)=>findings.push({level,text});add(c._score>=70?"ok":c._score>=52?"warn":"danger",`${c.name}: score ${c._score}/100, rischio ${c._risk}; momentum ${c._momentum}, liquidità ${c._liquidity}, tokenomics ${c._tokenomics}, controllo rischio ${c._riskScore}.`);if(c._catalogOnly)add("warn","Catalogo esteso CoinMarketCap: lo score usa soltanto i campi disponibili e non include lo storico completo del campione live.");if(action==="buy"&&maxCoin&&weight>maxCoin){quality-=25;add("danger",`Peso previsto ${weight.toFixed(1)}%: supera il limite personale del ${maxCoin.toFixed(0)}%.`)}else add("ok",`Peso previsto della crypto: ${weight.toFixed(1)}%${maxCoin?` rispetto al limite ${maxCoin.toFixed(0)}%`:"; limite personale non disponibile"}.`);if(action==="buy"&&capital&&cryptoAfter>num(p.maxCryptoAllocation)){quality-=18;add("danger",`Esposizione crypto prevista ${cryptoAfter.toFixed(1)}% del capitale investibile: oltre il limite del ${num(p.maxCryptoAllocation).toFixed(0)}%.`)}else if(action==="buy")add(capital?"ok":"warn",capital?`Esposizione crypto prevista: ${cryptoAfter.toFixed(1)}% del capitale investibile.`:"Compila il capitale investibile per misurare l’esposizione complessiva.");add(scenarioLoss>amount*.5?"warn":"ok",`Scenario didattico ${scenario}% sulla posizione: perdita stimata ${fmtEur(scenarioLoss)}; non è una previsione né una probabilità.`);add(fees>2?"warn":"ok",`Costi inseriti: ${fmtEur(feeCost)} (${fees.toFixed(1)}%). Spread e slippage reali possono essere diversi.`);if(["fomo","paura"].includes(emotion)){quality-=15;add("danger",`Stato emotivo dichiarato: ${emotion.toUpperCase()}. Valuta una pausa e riesamina a mercato invariato.`)}if(thesis.length<40){quality-=15;add("warn","La tesi è assente o troppo breve: descrivi fatti verificabili, orizzonte e motivo economico.")}else add("ok","La tesi ha una struttura minima verificabile.");if(invalidation.length<25){quality-=12;add("warn","Manca una condizione d’invalidazione sufficientemente concreta.")}else add("ok","È presente una condizione per riesaminare la tesi.");if(!sources.length){quality-=10;add("warn","Nessuna fonte registrata: aggiungi documentazione ufficiale e almeno una verifica indipendente.")}else add("ok",`${sources.length} fonti registrate nel passaporto.`);[["copilotPlanCheck",8,"Confronto con il piano"],["copilotProjectCheck",8,"Comprensione del progetto"],["copilotTaxCheck",8,"Controllo fiscale"]].forEach(([id,penalty,label])=>{if(!$(id).checked){quality-=penalty;add("warn",`${label} non confermato.`)}});const taxText=action==="buy"?"Conserva prova del costo, commissioni, data, quantità e cambio in euro.":action==="watch"?"L’osservazione non è un’operazione; nessun evento fiscale viene simulato.":"Vendita, pagamento o alcuni scambi possono avere rilevanza fiscale: conserva valori e verifica la classificazione.";add(action==="watch"?"ok":"warn",taxText);quality=clamp(Math.round(quality));const verdict=quality>=80?["Controllo solido","green-light","I controlli dichiarati sono coerenti; restano rischio di mercato e verifica finale."]:quality>=55?["Da approfondire","yellow-light","Sono presenti lacune o rischi da risolvere prima di decidere."]:["Fermati e riesamina","red-light","Il processo presenta criticità importanti o informazioni insufficienti."];currentCopilotResult={id:crypto.randomUUID(),createdAt:new Date().toISOString(),coinId:c.id,name:c.name,symbol:c.symbol.toUpperCase(),action,amount,fees,emotion,horizon:$("copilotHorizon").value,thesis,invalidation,sources,confirmations:{plan:$("copilotPlanCheck").checked,project:$("copilotProjectCheck").checked,tax:$("copilotTaxCheck").checked},snapshot:{price:c.current_price,score:c._score,risk:c._risk,rank:c.market_cap_rank,marketCap:c.market_cap,volume:c.total_volume,fdvRatio:c._dilution,components:{momentum:c._momentum,liquidity:c._liquidity,tokenomics:c._tokenomics,risk:c._riskScore}},impact:{currentCoinValue:current,projectedCoinValue:projectedCoin,projectedPortfolio:projectedTotal,weight,cryptoAllocation:cryptoAfter,scenario,scenarioLoss,feeCost},processScore:quality,verdict:verdict[0],findings};$("copilotLight").className=`verdict-light ${verdict[1]}`;$("copilotVerdict").textContent=verdict[0];$("copilotVerdictText").textContent=verdict[2];$("copilotMetrics").innerHTML=`<div><span>PROCESSO</span><b>${quality}/100</b></div><div><span>PESO PREVISTO</span><b>${weight.toFixed(1)}%</b></div><div><span>STRESS POSIZIONE</span><b>${fmtEur(scenarioLoss)}</b></div><div><span>COSTI INSERITI</span><b>${fmtEur(feeCost)}</b></div>`;$("copilotFindings").innerHTML=findings.map(x=>`<div class="analysis-item ${x.level}"><span></span><p>${esc(x.text)}</p></div>`).join("");$("savePassport").disabled=false}
function savePassport(){if(!currentCopilotResult)return;const list=localData(copilotStore.passports,[]);list.unshift(currentCopilotResult);saveLocalData(copilotStore.passports,list.slice(0,250));currentCopilotResult=null;$("savePassport").disabled=true;$("savePassport").textContent="Passaporto salvato ✓";setTimeout(()=>$("savePassport").textContent="Salva Passaporto",1400);renderPassports();renderBehaviorScore()}
function passportOutcome(p){const c=coinById(p.coinId),days=Math.floor((Date.now()-new Date(p.createdAt).getTime())/86400000),changePct=c&&num(p.snapshot?.price)?(c.current_price/num(p.snapshot.price)-1)*100:null;return {days,changePct,label:days>=90?"controllo 90g":days>=30?"controllo 30g":days>=7?"controllo 7g":`tra ${Math.max(0,7-days)}g primo controllo`}}
function renderPassports(){const list=localData(copilotStore.passports,[]),planned=list.filter(x=>x.confirmations?.plan).length,emotional=list.filter(x=>["fomo","paura"].includes(x.emotion)).length;$("passportCount").textContent=list.length;$("passportStats").innerHTML=`<article class="card metric"><span>Passaporti</span><strong>${list.length}</strong><small>massimo 250 locali</small></article><article class="card metric"><span>Confrontati col piano</span><strong>${list.length?Math.round(planned/list.length*100):0}%</strong><small>conferma dichiarata</small></article><article class="card metric"><span>FOMO o paura</span><strong>${emotional}</strong><small>da riesaminare</small></article>`;$("passportList").innerHTML=list.map(p=>{const out=passportOutcome(p);return `<article class="card passport-card"><div class="passport-id"><span>${esc(p.symbol)}</span><b>${esc(p.action)}</b><small>${new Date(p.createdAt).toLocaleString("it-IT")}</small></div><div><h3>${esc(p.verdict)} · processo ${num(p.processScore)}/100</h3><p>${esc(p.thesis||"Tesi non registrata")}</p><div class="journal-meta"><span class="badge">score ${num(p.snapshot?.score)}</span><span class="badge ${esc(p.snapshot?.risk||"")}">${esc(p.snapshot?.risk||"—")}</span><span class="badge">${out.label}${out.changePct==null?"":` · ${fmtPct(out.changePct)}`}</span></div></div><div class="passport-actions"><button class="secondary export-passport" data-id="${esc(p.id)}">Esporta</button><button class="journal-delete delete-passport" data-id="${esc(p.id)}">Elimina</button></div></article>`}).join("")||`<article class="card insight-card"><p class="muted">Nessun passaporto. Esegui il controllo 360 e salva il risultato.</p></article>`;document.querySelectorAll(".delete-passport").forEach(b=>b.onclick=()=>{if(!confirm("Eliminare questo passaporto?"))return;saveLocalData(copilotStore.passports,list.filter(x=>x.id!==b.dataset.id));renderPassports();renderBehaviorScore()});document.querySelectorAll(".export-passport").forEach(b=>b.onclick=()=>{const p=list.find(x=>x.id===b.dataset.id);if(p)downloadBlob(`passaporto-${p.symbol}-${p.createdAt.slice(0,10)}.json`,JSON.stringify(p,null,2))})}
function scoreSnapshot(){return localData(copilotStore.scores,null)}
function trackedScoreCoins(){const ids=[...new Set([...pinnedIds(),...(state.portfolio?.holdings||[]).map(h=>h.id)])];return (ids.length?ids:["bitcoin","ethereum"]).map(coinById).filter(Boolean)}
function saveScoreSnapshot(){const coins={};trackedScoreCoins().forEach(c=>coins[c.id]={name:c.name,symbol:c.symbol.toUpperCase(),score:c._score,price:c.current_price,components:{momentum:c._momentum,liquidity:c._liquidity,tokenomics:c._tokenomics,risk:c._riskScore}});saveLocalData(copilotStore.scores,{createdAt:new Date().toISOString(),coins});renderScoreChanges();$("saveScoreSnapshot").textContent="Fotografia salvata ✓";setTimeout(()=>$("saveScoreSnapshot").textContent="Salva fotografia score",1400)}
function renderScoreChanges(){const snap=scoreSnapshot(),coins=trackedScoreCoins(),changes=coins.map(c=>{const old=snap?.coins?.[c.id],parts=old?Object.entries(c._momentum==null?{}:{momentum:c._momentum-old.components.momentum,liquidità:c._liquidity-old.components.liquidity,tokenomics:c._tokenomics-old.components.tokenomics,rischio:c._riskScore-old.components.risk}).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1])):[];return {c,old,delta:old?c._score-old.score:null,price:old?(c.current_price/old.price-1)*100:null,parts}}),up=changes.filter(x=>x.delta>0).length,down=changes.filter(x=>x.delta<0).length;$("scoreChangeSummary").innerHTML=`<article class="card metric"><span>Crypto confrontate</span><strong>${coins.length}</strong><small>fissate o in portafoglio</small></article><article class="card metric"><span>Score migliorato</span><strong>${up}</strong><small>dall’ultima fotografia</small></article><article class="card metric"><span>Score peggiorato</span><strong>${down}</strong><small>${snap?new Date(snap.createdAt).toLocaleDateString("it-IT"):"fotografia assente"}</small></article>`;$("scoreChangeList").innerHTML=changes.map(({c,old,delta,price,parts})=>`<article class="card score-change-card"><div>${coinCell(c)}</div><div class="score-change-main"><span>ORA</span><b class="${scoreColor(c._score)}">${c._score}</b>${old?`<i class="${pctClass(delta)}">${delta>=0?"+":""}${delta}</i>`:`<small>salva una base di confronto</small>`}</div><div class="score-change-reasons">${old?`<p>Prezzo ${fmtPct(price)} dal salvataggio.</p>${parts.slice(0,3).map(([k,v])=>`<span><b>${esc(k)}</b> ${v>=0?"+":""}${Math.round(v)}</span>`).join("")}`:`<p>Momentum ${c._momentum} · Liquidità ${c._liquidity} · Tokenomics ${c._tokenomics} · Rischio ${c._riskScore}</p>`}</div></article>`).join("")}
function runSecurityRadar(){const type=$("securityType").value,name=$("securityName").value.trim(),raw=$("securityUrl").value.trim(),contract=$("securityContract").value.trim(),checks=[...document.querySelectorAll("[data-security-check]")],done=checks.filter(x=>x.checked).length;let score=done*12,findings=[];const add=(level,text)=>findings.push({level,text});if(!name){score-=10;add("warn","Inserisci il nome esatto del soggetto o token.")}if(!raw){score-=15;add("danger","Manca un URL da confrontare con la fonte ufficiale.")}else{try{const url=new URL(raw);if(url.protocol!=="https:"){score-=25;add("danger","Il collegamento non usa HTTPS.")}else add("ok",`Dominio analizzato: ${url.hostname}. Verificalo carattere per carattere.`);if(url.hostname.startsWith("xn--")){score-=25;add("danger","Il dominio usa una codifica internazionale: controlla possibili caratteri imitati.")}if(/@|%00|\s/.test(raw)){score-=20;add("danger","Il collegamento contiene caratteri anomali.")}}catch{score-=30;add("danger","URL non valido o incompleto.")}}if(type==="token"&&!contract){score-=15;add("warn","Per un token manca rete e contract address: il ticker non basta.")}if(type==="provider"&&!checks.find(x=>x.dataset.securityCheck==="registry")?.checked)add("danger","Autorizzazione o registro del fornitore non verificati.");if(!checks.find(x=>x.dataset.securityCheck==="official")?.checked)add("danger","Il collegamento non è stato confermato tramite documentazione ufficiale.");if(!checks.find(x=>x.dataset.securityCheck==="permissions")?.checked)add("warn","Permessi o firma richiesta non sono stati compresi.");if(!checks.find(x=>x.dataset.securityCheck==="incidents")?.checked)add("warn","Manca una ricerca su incidenti, exploit e avvisi recenti.");score=clamp(Math.round(score));const title=score>=80?"Controlli preliminari completi":score>=55?"Verifiche ancora necessarie":"Rischio informativo elevato";$("securityRadarScore").textContent=`${score}/100`;$("securityRadarScore").className=`security-score ${score>=80?'positive':score>=55?'neutral':'negative'}`;$("securityRadarTitle").textContent=title;$("securityRadarFindings").innerHTML=findings.map(x=>`<div class="analysis-item ${x.level}"><span></span><p>${esc(x.text)}</p></div>`).join("")||`<div class="analysis-item ok"><span></span><p>Checklist completata: verifica comunque fonti e autorizzazioni nel momento dell’uso.</p></div>`;const history=localData(copilotStore.security,[]);history.unshift({date:new Date().toISOString(),type,name,url:raw,contract,score});saveLocalData(copilotStore.security,history.slice(0,50));renderBehaviorScore()}
function behaviorCalculation(){const academy=loadAcademyState(),lessonInputs=[...document.querySelectorAll("[data-complete]")],lessonDone=lessonInputs.filter(x=>academy.lessons?.[x.dataset.complete]).length,passports=localData(copilotStore.passports,[]),tax=taxReadinessCalculation(),snapshots=localData("cryptoRadarWeeklySnapshots",[]),security=localData(copilotStore.security,[]),plan=state.plan||{},profile=localData(copilotStore.profile,{});let score=0,parts=[];const add=(label,value,max)=>{score+=value;parts.push({label,value,max})};add("Formazione",lessonInputs.length?lessonDone/lessonInputs.length*20:0,20);add("Piano personale",plan.totalInvestableCapital&&plan.maxSingleCoin?15:0,15);add("Decisioni documentate",Math.min(passports.length/3,1)*20,20);add("Preparazione fiscale",tax.score/100*20,20);add("Revisioni settimanali",Math.min(snapshots.length/4,1)*10,10);add("Controlli sicurezza",Math.min(security.length/3,1)*5,5);add("Home personale",pinnedIds().length?5:0,5);add("Profilo e obiettivo",profile.name&&profile.goal?5:0,5);return {score:Math.round(score),parts}}
function renderBehaviorScore(){const result=behaviorCalculation();$("behaviorScore").textContent=result.score;$("behaviorScore").title=result.parts.map(x=>`${x.label}: ${Math.round(x.value)}/${x.max}`).join(" · ");if($("behaviorBreakdown"))$("behaviorBreakdown").innerHTML=result.parts.map(x=>`<div><span>${esc(x.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(x.value/x.max*100)}%"></div></div><b>${Math.round(x.value)}/${x.max}</b></div>`).join("")}
function localProfile(){return {...{name:"",experience:"beginner",goal:"learn"},...localData(copilotStore.profile,{})}}
function renderPrivacy(){const p=localProfile();$("profileName").value=p.name;$("profileExperience").value=p.experience;$("profileGoal").value=p.goal;const rows=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith("cryptoRadar"))continue;const value=localStorage.getItem(key)||"";rows.push({key,bytes:new Blob([value]).size})}const total=rows.reduce((s,x)=>s+x.bytes,0),details=rows.length?rows.map(x=>`<div><span>${esc(x.key)}</span><b>${(x.bytes/1024).toFixed(1)} KB</b></div>`).join(""):`<p class="muted">Nessun dato Crypto Radar presente.</p>`;$("privacyInventory").innerHTML=`<div class="privacy-total"><b>${rows.length}</b><span>archivi locali · ${(total/1024).toFixed(1)} KB</span></div>${details}`}
function saveLocalProfile(){saveLocalData(copilotStore.profile,{name:$("profileName").value.trim().slice(0,40),experience:$("profileExperience").value,goal:$("profileGoal").value,updatedAt:new Date().toISOString()});renderBehaviorScore();renderPrivacy();$("saveLocalProfile").textContent="Profilo salvato ✓";setTimeout(()=>$("saveLocalProfile").textContent="Salva profilo locale",1400)}
function allLocalData(){const data={exportedAt:new Date().toISOString(),version:1,storage:{}};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith("cryptoRadar")){try{data.storage[key]=JSON.parse(localStorage.getItem(key))}catch{data.storage[key]=localStorage.getItem(key)}}}return data}
function downloadAllLocal(){downloadBlob(`crypto-radar-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(allLocalData(),null,2))}
async function restoreLocalBackup(file){try{const backup=JSON.parse(await file.text()),storage=backup?.storage;if(!storage||typeof storage!=="object"||Array.isArray(storage))throw new Error("Formato backup non valido.");const keys=Object.keys(storage).filter(key=>key.startsWith("cryptoRadar"));if(!keys.length)throw new Error("Il backup non contiene dati Crypto Radar.");if(!confirm(`Ripristinare ${keys.length} archivi locali da questo backup? I dati Crypto Radar presenti in questo browser verranno sostituiti.`))return;[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).filter(key=>key?.startsWith("cryptoRadar")).forEach(key=>localStorage.removeItem(key));keys.forEach(key=>{const value=storage[key];localStorage.setItem(key,typeof value==="string"?value:JSON.stringify(value))});try{await api("/api/restore-local-backup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(backup)})}catch{}location.reload()}catch(error){showError(error.message||"Backup non leggibile.")}}
function ensureRestoreLocalControl(){const actions=document.querySelector(".privacy-actions");if(!actions||$("restoreLocalData"))return;const button=document.createElement("button");button.id="restoreLocalData";button.className="secondary";button.textContent="Ripristina backup JSON";const input=document.createElement("input");input.id="restoreLocalFile";input.className="hidden";input.type="file";input.accept="application/json,.json";button.onclick=()=>input.click();input.onchange=()=>{const file=input.files?.[0];if(file)restoreLocalBackup(file);input.value=""};actions.insertBefore(button,$("deleteLocalData"));actions.insertBefore(input,$("deleteLocalData"))}
function generateShareReport(){const include=key=>document.querySelector(`[data-share="${key}"]`)?.checked,hide=$("shareHideAmounts").checked,audience=$("shareAudience").value,profile=localProfile(),positions=activePositions(),behavior=behaviorCalculation(),fiscal=taxReadinessState(),passports=localData(copilotStore.passports,[]);const money=x=>hide?"[nascosto]":fmtEur(x),sections=[];if(include("overview"))sections.push(`<h2>Panoramica</h2><table><tr><th>Asset</th><th>Quantità</th><th>Valore</th><th>Peso</th></tr>${positions.map(p=>`<tr><td>${esc(p.symbol)}</td><td>${hide?'[nascosta]':num(p.amount)}</td><td>${money(p.value)}</td><td>${positions.reduce((s,x)=>s+x.value,0)?(p.value/positions.reduce((s,x)=>s+x.value,0)*100).toFixed(1):0}%</td></tr>`).join("")}</table>`);if(include("plan"))sections.push(`<h2>Piano</h2><p>Orizzonte: ${num(state.plan?.horizonYears)} anni · perdita tollerabile ${num(state.plan?.maxToleratedLoss)}% · singola crypto massimo ${num(state.plan?.maxSingleCoin)}% · crypto massimo ${num(state.plan?.maxCryptoAllocation)}%.</p>`);if(include("behavior"))sections.push(`<h2>Disciplina</h2><p>Punteggio di processo: ${behavior.score}/100. Non misura abilità o rendimento.</p>`);if(include("fiscal")){const calc=taxReadinessCalculation(fiscal);sections.push(`<h2>Preparazione fiscale</h2><p>${calc.score}% · ${calc.total} transazioni · ${calc.issues} anomalie dichiarate.</p>${include("notes")?`<p>Note: ${esc(fiscal.notes||"Nessuna")}</p>`:""}`)}if(include("passports"))sections.push(`<h2>Passaporti</h2>${passports.slice(0,20).map(p=>`<div class="box"><b>${esc(p.symbol)} · ${esc(p.action)} · processo ${num(p.processScore)}/100</b><p>${esc(p.thesis||"Tesi assente")}</p></div>`).join("")||"<p>Nessun passaporto.</p>"}`);const html=`<!doctype html><html lang="it"><meta charset="utf-8"><title>Report Crypto Radar</title><style>body{font:15px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#17202a}h1{margin-bottom:4px}.meta{color:#667}table{border-collapse:collapse;width:100%}td,th{padding:9px;border:1px solid #ccd;text-align:left}.box{border:1px solid #ccd;padding:12px;margin:8px 0;border-radius:8px}.warning{background:#fff7dd;padding:12px;border-left:4px solid #d99b12}</style><h1>Crypto Radar · Report in sola lettura</h1><p class="meta">Destinatario: ${esc(audience)} · generato ${new Date().toLocaleString("it-IT")} · profilo ${esc(profile.name||"non indicato")}</p><p class="warning">Documento informativo generato dall’utente. Non è consulenza finanziaria o fiscale e non contiene accesso agli account.</p>${sections.join("")}<hr><small>Verificare dati, fonti e documenti originali prima di qualsiasi utilizzo.</small></html>`;downloadBlob(`crypto-radar-report-${audience}-${new Date().toISOString().slice(0,10)}.html`,html,"text/html;charset=utf-8")}
let onboardingStep=0;
function interfaceMode(){return localStorage.getItem("cryptoRadarInterfaceMode")||"beginner"}
function applyInterfaceMode(mode=interfaceMode()){const normalized=mode==="advanced"?"advanced":"beginner";localStorage.setItem("cryptoRadarInterfaceMode",normalized);document.body.classList.toggle("mode-beginner",normalized==="beginner");document.body.classList.toggle("mode-advanced",normalized==="advanced");$("interfaceMode").textContent=`Modalità: ${normalized==="beginner"?"Principiante":"Avanzata"}`;$("interfaceMode").dataset.mode=normalized;applySidebarLayout(false)}
function setOnboardingStep(step){onboardingStep=clamp(step,0,3);document.querySelectorAll("[data-onboarding-step]").forEach(x=>x.classList.toggle("active",num(x.dataset.onboardingStep)===onboardingStep));$("onboardingStepLabel").textContent=`Passaggio ${onboardingStep+1} di 4`;$("onboardingBar").style.width=`${(onboardingStep+1)/4*100}%`;$("onboardingBack").disabled=onboardingStep===0;$("onboardingNext").textContent=onboardingStep===3?"Completa configurazione":"Continua";if(onboardingStep===3)renderOnboardingReview()}
function onboardingSelectedCoins(){return [...document.querySelectorAll("[data-onboarding-coin]:checked")].map(x=>x.value).slice(0,5)}
function ensureOnboardingUsernameAlert(){if($("onboardingUsernameAlert"))return;const input=$("onboardingName"),label=input.closest("label"),labelText=[...label.childNodes].find(node=>node.nodeType===Node.TEXT_NODE);labelText?.replaceWith(document.createTextNode("Username pubblico"));const notice=document.createElement("div");notice.id="onboardingUsernameAlert";notice.className="onboarding-username-alert";notice.setAttribute("role","note");notice.innerHTML="<b>Username pubblico</b><span>Il nome che scegli sarà visibile e utilizzato nella Chat Community. Non inserire cognome o dati personali.</span>";label.insertAdjacentElement("afterend",notice);input.setAttribute("aria-describedby",notice.id)}
function renderOnboarding(){if(!state.scored.length)return;applyInterfaceMode();ensureOnboardingUsernameAlert();const profile=localProfile(),selected=new Set(pinnedIds()),coins=state.scored.filter(c=>!stableLike(c)&&c.market_cap_rank<=100).slice(0,30),username=$("onboardingName");$("onboardingCoins").innerHTML=coins.map(c=>`<label class="onboarding-coin"><input type="checkbox" value="${esc(c.id)}" data-onboarding-coin ${selected.has(c.id)?"checked":""}><img src="${esc(c.image)}" alt=""><span><b>${esc(c.symbol.toUpperCase())}</b><small>${esc(c.name)}</small></span></label>`).join("");username.value=(profile.name||"").slice(0,40);username.required=true;username.minLength=2;username.maxLength=40;username.autocomplete="nickname";$("onboardingExperience").value=profile.experience||"beginner";$("onboardingGoal").value=profile.goal||"learn";$("onboardingMode").value=interfaceMode();$("onboardingCapital").value=state.plan?.totalInvestableCapital||"";$("onboardingHorizon").value=state.plan?.horizonYears||5;$("onboardingLoss").value=state.plan?.maxToleratedLoss||25;document.querySelectorAll("[data-onboarding-coin]").forEach(x=>x.onchange=()=>{const checked=onboardingSelectedCoins();document.querySelectorAll("[data-onboarding-coin]:not(:checked)").forEach(y=>y.disabled=checked.length>=5)});if(!localStorage.getItem("cryptoRadarOnboardingComplete")&&!sessionStorage.getItem("cryptoRadarOnboardingDismissed"))setTimeout(()=>openOnboarding(),500)}
function renderOnboardingReview(){const selected=onboardingSelectedCoins().map(coinById).filter(Boolean);$("onboardingReview").innerHTML=`<div><span>USERNAME PUBBLICO</span><b>${esc($("onboardingName").value.trim()||"Username non indicato")}</b><small>${esc($("onboardingExperience").selectedOptions[0].textContent)}</small></div><div><span>MODALITÀ</span><b>${esc($("onboardingMode").selectedOptions[0].textContent)}</b><small>${esc($("onboardingGoal").selectedOptions[0].textContent)}</small></div><div><span>LIMITI</span><b>${fmtEur(num($("onboardingCapital").value))}</b><small>${num($("onboardingHorizon").value)} anni · perdita ${num($("onboardingLoss").value)}%</small></div><div><span>HOME</span><b>${selected.length} crypto</b><small>${selected.map(c=>c.symbol.toUpperCase()).join(", ")||"nessuna selezione"}</small></div>`}
function openOnboarding(){setOnboardingStep(0);$("onboardingOverlay").classList.remove("hidden");document.body.classList.add("modal-open")}
function closeOnboarding(){sessionStorage.setItem("cryptoRadarOnboardingDismissed","1");$("onboardingOverlay").classList.add("hidden");document.body.classList.remove("modal-open")}
function validateOnboardingUsername(){const input=$("onboardingName"),username=input.value.trim();input.setCustomValidity(username.length>=2?"":"Lo username deve contenere almeno 2 caratteri.");if(!input.reportValidity())return false;input.value=username.slice(0,40);return true}
function completeOnboarding(){if(!validateOnboardingUsername())return;if(!$("onboardingEmergency").checked){$("onboardingNext").textContent="Conferma il capitale non necessario";return}const profile={name:$("onboardingName").value.trim().slice(0,40),experience:$("onboardingExperience").value,goal:$("onboardingGoal").value,updatedAt:new Date().toISOString()};saveLocalData(copilotStore.profile,profile);savePinnedIds(onboardingSelectedCoins());applyInterfaceMode($("onboardingMode").value);state.plan={...(state.plan||{}),totalInvestableCapital:Math.max(0,num($("onboardingCapital").value)),horizonYears:clamp(num($("onboardingHorizon").value),1,50),maxToleratedLoss:clamp(num($("onboardingLoss").value),0,100)};if(state.demo)saveLocalData("cryptoRadarPlan",state.plan);localStorage.setItem("cryptoRadarOnboardingComplete",new Date().toISOString());closeOnboarding();renderOverview();renderPlan();renderCopilot();showPage(profile.goal==="learn"?"academy":profile.goal==="tax"?"tax":profile.goal==="risk"?"copilot":"portfolio")}
function nextOnboarding(){if(onboardingStep===0&&!validateOnboardingUsername())return;if(onboardingStep<3){setOnboardingStep(onboardingStep+1);return}completeOnboarding()}
function cooldownState(){return localData("cryptoRadarCooldown",null)}
function startCooldown(hours){const coin=coinById($("copilotCoin").value);saveLocalData("cryptoRadarCooldown",{startedAt:new Date().toISOString(),endAt:new Date(Date.now()+hours*3600000).toISOString(),hours,coinId:coin?.id||"",symbol:coin?.symbol?.toUpperCase()||"",reason:$("copilotEmotion").value,notified:false});checkCooldown()}
function cancelCooldown(){if(!confirm("Terminare volontariamente la pausa? Prima rileggi la tesi e annota che cosa è cambiato."))return;localStorage.removeItem("cryptoRadarCooldown");checkCooldown()}
function runCopilotWithCooldown(){
  runCopilot();
  if(!currentCopilotResult)return;
  const suggested=["fomo","paura"].includes(currentCopilotResult.emotion)||currentCopilotResult.processScore<55;
  if(suggested&&!cooldownState()){
    $("cooldownCard").classList.remove("hidden");
    $("cooldownTitle").textContent="Una pausa può proteggere il processo";
    $("cooldownText").textContent=`Stato ${currentCopilotResult.emotion} · processo ${currentCopilotResult.processScore}/100. La pausa non prevede il mercato: separa la decisione dall'urgenza.`;
    $("cooldownActions").innerHTML=`<button class="secondary" data-cooldown-hours="12">Pausa 12 ore</button><button class="secondary" data-cooldown-hours="24">Pausa 24 ore</button>`;
    document.querySelectorAll("[data-cooldown-hours]").forEach(button=>button.onclick=()=>startCooldown(num(button.dataset.cooldownHours)));
  }else checkCooldown();
}
function checkCooldown(){if(!$("cooldownCard"))return;const data=cooldownState(),remaining=data?new Date(data.endAt).getTime()-Date.now():0;if(!data){$("cooldownCard").classList.add("hidden");return}$("cooldownCard").classList.remove("hidden");if(remaining<=0){$("cooldownTitle").textContent=`Pausa completata${data.symbol?` per ${data.symbol}`:""}`;$("cooldownText").textContent="Riesamina la tesi: sono cambiati i fatti oppure soltanto il prezzo e l’emozione?";$("cooldownActions").innerHTML=`<button class="primary" data-cooldown-review>Riesamina ora</button><button class="secondary" data-cooldown-clear>Archivia pausa</button>`;if(!data.notified&&"Notification" in window&&Notification.permission==="granted"){new Notification("Crypto Radar · pausa completata",{body:"Riesamina tesi e condizioni prima di decidere."});data.notified=true;saveLocalData("cryptoRadarCooldown",data)}}else{const hours=Math.floor(remaining/3600000),minutes=Math.ceil((remaining%3600000)/60000);$("cooldownTitle").textContent=`Pausa attiva${data.symbol?` · ${data.symbol}`:""}`;$("cooldownText").textContent=`Restano ${hours}h ${minutes}m. Puoi continuare a studiare, ma evita di trasformare il movimento del prezzo in una nuova tesi.`;$("cooldownActions").innerHTML=`<span class="cooldown-clock">${hours}h ${minutes}m</span><button class="secondary" data-cooldown-cancel>Termina dopo revisione</button>`;setTimeout(checkCooldown,60000)}document.querySelector("[data-cooldown-cancel]")?.addEventListener("click",cancelCooldown);document.querySelector("[data-cooldown-clear]")?.addEventListener("click",()=>{localStorage.removeItem("cryptoRadarCooldown");checkCooldown()});document.querySelector("[data-cooldown-review]")?.addEventListener("click",()=>{localStorage.removeItem("cryptoRadarCooldown");checkCooldown();$("copilotThesis").focus()})}
function monthEntries(){const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1).getTime(),passports=localData(copilotStore.passports,[]).filter(x=>new Date(x.createdAt).getTime()>=start),journal=(state.journal||[]).filter(x=>num(x.createdAt)*1000>=start);return {passports,journal}}
function monthlyBehaviorData(){const {passports,journal}=monthEntries(),total=passports.length,planned=passports.filter(x=>x.confirmations?.plan).length,emotional=passports.filter(x=>["fomo","paura"].includes(x.emotion)).length,sourced=passports.filter(x=>(x.sources||[]).length>=2).length,invalidated=passports.filter(x=>(x.invalidation||"").length>=25).length,average=total?passports.reduce((s,x)=>s+num(x.processScore),0)/total:0;return {passports,journal,total,planned,emotional,sourced,invalidated,average}}
function renderMonthlyBehavior(){if(!$("monthlyBehaviorMetrics"))return;const d=monthlyBehaviorData(),pct=x=>d.total?Math.round(x/d.total*100):0;$("monthlyBehaviorMetrics").innerHTML=`<article class="card metric"><span>Decisioni documentate</span><strong>${d.total+d.journal.length}</strong><small>${d.total} Passaporti · ${d.journal.length} diario</small></article><article class="card metric"><span>Processo medio</span><strong>${d.average.toFixed(0)}</strong><small>/100 nei Passaporti</small></article><article class="card metric"><span>FOMO o paura</span><strong>${d.emotional}</strong><small>${pct(d.emotional)}% dei Passaporti</small></article>`;const parts=[{label:"Confronto col piano",value:pct(d.planned)},{label:"Almeno due fonti",value:pct(d.sourced)},{label:"Invalidazione concreta",value:pct(d.invalidated)},{label:"Decisioni non emotive",value:100-pct(d.emotional)}];$("monthlyBehaviorDetails").innerHTML=parts.map(x=>`<div><span>${esc(x.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${x.value}%"></div></div><b>${x.value}%</b></div>`).join("");const actions=[];if(!d.total)actions.push("Crea almeno un Passaporto, anche per una decisione di non agire.");if(pct(d.planned)<80)actions.push("Confronta ogni importo con i limiti del Piano personale.");if(pct(d.sourced)<70)actions.push("Registra almeno una fonte primaria e una verifica indipendente.");if(d.emotional)actions.push("Riesamina le decisioni in FOMO o paura dopo una pausa volontaria.");if(pct(d.invalidated)<80)actions.push("Scrivi condizioni d’invalidazione osservabili e non solo soglie di prezzo.");$("monthlyBehaviorActions").innerHTML=(actions.length?actions:["Il processo dichiarato è coerente. Verifica comunque risultati, costi e tesi senza aumentare la frequenza operativa."]).map(x=>`<div class="risk-item">${esc(x)}</div>`).join("");$("monthlyDecisionList").innerHTML=d.passports.slice(0,12).map(p=>`<article class="card passport-card"><div class="passport-id"><span>${esc(p.symbol)}</span><b>${esc(p.action)}</b><small>${new Date(p.createdAt).toLocaleDateString("it-IT")}</small></div><div><h3>Processo ${num(p.processScore)}/100</h3><p>${esc(p.thesis||"Tesi assente")}</p></div><span class="badge ${["fomo","paura"].includes(p.emotion)?"alto":"basso"}">${esc(p.emotion)}</span></article>`).join("")||`<article class="card insight-card"><p class="muted">Il report si popolerà con i Passaporti del mese corrente.</p></article>`}
function exportMonthlyBehavior(){const d=monthlyBehaviorData(),html=`<!doctype html><html lang="it"><meta charset="utf-8"><title>Report comportamento Crypto Radar</title><style>body{font:15px system-ui;max-width:850px;margin:40px auto;padding:20px;color:#17202a}.box{border:1px solid #ccd;border-radius:8px;padding:12px;margin:8px 0}</style><h1>Crypto Radar · Report mensile del comportamento</h1><p>${new Date().toLocaleDateString("it-IT",{month:"long",year:"numeric"})} · ${d.total} Passaporti · processo medio ${d.average.toFixed(0)}/100.</p><p>Questo report misura il processo dichiarato, non competenza, adeguatezza o rendimento.</p>${d.passports.map(p=>`<div class="box"><b>${esc(p.symbol)} · ${esc(p.action)} · ${num(p.processScore)}/100</b><p>${esc(p.thesis||"Tesi assente")}</p></div>`).join("")}</html>`;downloadBlob(`crypto-radar-comportamento-${new Date().toISOString().slice(0,7)}.html`,html,"text/html;charset=utf-8")}
function dataQualityCalculation(){const age=state.marketAsOf?Math.max(0,Date.now()/1000-state.marketAsOf):Infinity,missing=state.scored.filter(c=>!c.current_price||!c.market_cap||!c.total_volume).length,holdings=state.portfolio?.holdings||[],incomplete=holdings.filter(h=>num(h.amount)<=0||num(h.avgCost)<=0).length,tax=taxReadinessCalculation(),issues=[];let score=100;if(state.marketStale){score-=25;issues.push("Il mercato usa uno snapshot di riserva: non basare decisioni sul prezzo mostrato.")}if(age>86400){score-=15;issues.push(`Lo snapshot mercato ha ${Math.floor(age/86400)} giorni.`)}if(missing){score-=Math.min(15,missing);issues.push(`${missing} asset hanno campi di mercato mancanti.`)}if(incomplete){score-=Math.min(20,incomplete*4);issues.push(`${incomplete} posizioni hanno quantità o costo medio incompleti.`)}if(!holdings.length){score-=10;issues.push("Il portafoglio personale è vuoto.")}if(!state.plan?.totalInvestableCapital){score-=10;issues.push("Manca il capitale investibile nel Piano personale.")}if(tax.issues){score-=Math.min(15,tax.issues);issues.push(`${tax.issues} anomalie fiscali dichiarate sono ancora aperte.`)}return {score:clamp(Math.round(score)),age,missing,incomplete,tax,issues}}
function renderDataQuality(){if(!$("dataQualityMetrics"))return;const q=dataQualityCalculation(),level=q.score>=85?"Alta":q.score>=60?"Intermedia":"Bassa";$("dataQualityBadge").textContent=`Qualità dati: ${level}`;$("dataQualityBadge").className=`data-quality-badge ${q.score>=85?'quality-good':q.score>=60?'quality-warn':'quality-bad'}`;$("dataQualityMetrics").innerHTML=`<article class="card metric"><span>Qualità complessiva</span><strong>${q.score}</strong><small>/100 · completezza tecnica</small></article><article class="card metric"><span>Mercati disponibili</span><strong>${state.scored.length}</strong><small>${state.marketStale?'snapshot di riserva':'fonte live'}</small></article><article class="card metric"><span>Dati personali</span><strong>${(state.portfolio?.holdings||[]).length}</strong><small>${q.incomplete} posizioni incomplete</small></article>`;const freshness=state.marketAsOf?new Date(state.marketAsOf*1000).toLocaleString("it-IT"):"non disponibile";$("dataSourceStatus").innerHTML=`<div><span class="source-dot ${state.marketStale?'stale':'live'}"></span><div><b>Mercati CoinGecko</b><small>${state.marketStale?'RISERVA':'LIVE'} · ${freshness} · ${state.scored.length} asset</small></div></div><div><span class="source-dot local"></span><div><b>Portafoglio, piano e Assistente Personale</b><small>LOCALE · questo browser · nessuna sincronizzazione</small></div></div><div><span class="source-dot ${state.news.length?'live':'stale'}"></span><div><b>News</b><small>${state.news.length?`${state.news.length} articoli caricati`:'fonte non disponibile'}</small></div></div><div><span class="source-dot estimated"></span><div><b>Score e stress test</b><small>CALCOLATO/STIMATO · metodologia interna</small></div></div>`;$("dataQualityIssues").innerHTML=(q.issues.length?q.issues:["Nessuna lacuna tecnica rilevata nei controlli disponibili."]).map(x=>`<div class="risk-item ${q.score<60?'warn':''}">${esc(x)}</div>`).join("")}
function openCopilotTab(tab){showPage("copilot");const button=document.querySelector(`[data-copilot-tab="${tab}"]`);if(button)button.click()}
let deferredInstallPrompt=null;
function setupPwa(){if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js").catch(()=>{});window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();deferredInstallPrompt=event;$("installApp").classList.remove("hidden")});$("installApp").onclick=async()=>{if(!deferredInstallPrompt)return;deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;$("installApp").classList.add("hidden")};$("enableNotifications").onclick=async()=>{if(!("Notification" in window)){showError("Le notifiche non sono supportate da questo browser.");return}const permission=await Notification.requestPermission();$("enableNotifications").textContent=permission==="granted"?"Notifiche abilitate ✓":"Notifiche non abilitate"}}
async function loadMarketIntelligence(showFlash=false){
  const button=$("refreshIntelligence");if(button&&showFlash){button.disabled=true;button.textContent="Aggiornamento…"}
  try{state.marketIntelligence=await api("/api/market-intelligence");renderHomeMarketTemperature();renderIntelligence();window.CryptoRadarI18n?.translateDocument()}
  catch(error){if($("intelligenceDataNote"))$("intelligenceDataNote").textContent=`Indici non disponibili: ${error.message}`}
  finally{if(button){button.disabled=false;button.textContent="Aggiorna indici"}}
}
function fearLabel(value){return tr(value<=24?"Paura estrema":value<=44?"Paura":value<=55?"Neutrale":value<=74?"Avidità":"Avidità estrema")}
function renderHomeMarketTemperature(){const data=state.marketIntelligence;if(!$("homeFearGreed"))return;if(!data){$("homeFearGreed").textContent=$("homeAltcoinSeason").textContent=$("homeBtcDominance").textContent=$("homeCmc100").textContent="—";return}const fear=num(data.fearGreed?.value),alt=num(data.altcoinSeason?.altcoin_index);$("homeFearGreed").textContent=fear||"—";$("homeFearGreedLabel").textContent=fear?fearLabel(fear):tr("Dato non disponibile");$("homeAltcoinSeason").textContent=alt||"—";$("homeAltcoinLabel").textContent=tr(alt>=75?"Prevalenza altcoin":alt<=25?"Prevalenza Bitcoin":"Fase intermedia");$("homeBtcDominance").textContent=data.global?.btcDominance!=null?`${num(data.global.btcDominance).toFixed(1)}%`:"—";$("homeCmc100").textContent=fmtPct(data.cmc100?.change24h);$("homeCmc100").className=pctClass(num(data.cmc100?.change24h));$("homeIntelligenceAsOf").textContent=data.asOf?`CMC · ${new Date(data.asOf).toLocaleString(uiLocale(),{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}`:tr("Fonte CoinMarketCap")}
function miniLine(id,values,color="#61b7ff"){const el=$(id),clean=(values||[]).map(num).filter(Number.isFinite);if(!el)return;if(clean.length<2){el.innerHTML="";return}const min=Math.min(...clean),max=Math.max(...clean),span=max-min||1,points=clean.map((value,index)=>`${index/(clean.length-1)*100},${56-(value-min)/span*48}`).join(" ");el.innerHTML=`<svg viewBox="0 0 100 60" preserveAspectRatio="none" aria-label="Andamento degli ultimi 30 giorni"><line class="grid" x1="0" y1="8" x2="100" y2="8"/><line class="grid" x1="0" y1="32" x2="100" y2="32"/><line class="grid" x1="0" y1="56" x2="100" y2="56"/><polyline class="line" style="stroke:${color}" points="${points}"/></svg>`}
function renderTemperature(){const data=state.marketIntelligence;if(!$("fearValue"))return;if(!data){$("intelligenceDataNote").textContent=tr("Caricamento degli indici aggregati…");return}const fear=num(data.fearGreed?.value),alt=num(data.altcoinSeason?.altcoin_index),global=data.global||{},cmc=data.cmc100||{},errors=Object.keys(data.errors||{});$("intelligenceDataNote").textContent=`${data.source} · ${data.asOf?new Date(data.asOf).toLocaleString(uiLocale()):tr("orario non disponibile")} · ${errors.length?`${errors.length} ${tr("serie non disponibili")}`:tr("aggiornamento server ogni 5 minuti")}`;$("fearValue").textContent=fear||"—";$("fearInterpretation").textContent=fear?`${fearLabel(fear)}. ${tr("Descrive il sentiment corrente, non un punto di inversione.")}`:tr("Dato non disponibile.");$("fearGauge").style.setProperty("--value",`${clamp(fear)*2.8}deg`);$("altcoinValue").textContent=alt||"—";$("altcoinInterpretation").textContent=tr(alt>=75?"Fase classificata come Altcoin Season; qualità e liquidità restano da verificare.":alt<=25?"Prevalenza relativa di Bitcoin nel periodo osservato.":"Zona intermedia: nessuna prevalenza netta.");$("altcoinGauge").style.setProperty("--value",`${clamp(alt)*2.8}deg`);miniLine("fearHistoryChart",(data.fearHistory||[]).slice().reverse().map(x=>x.value));miniLine("altcoinHistoryChart",(data.altcoinHistory||[]).map(x=>x.altcoin_index),"#9a86ff");$("globalMarketMetrics").innerHTML=[[tr("Dominanza BTC"),`${num(global.btcDominance).toFixed(1)}%`,global.btcDominanceChange24h],[tr("Dominanza ETH"),`${num(global.ethDominance).toFixed(1)}%`,null],[tr("Capitalizzazione globale"),fmtEur(global.totalMarketCap,true),global.marketCapChange24h],[tr("Volume 24 ore"),fmtEur(global.totalVolume24h,true),global.volumeChange24h],[tr("Crypto attive"),new Intl.NumberFormat(uiLocale()).format(num(global.activeCryptocurrencies)),null],[tr("Mercati attivi"),new Intl.NumberFormat(uiLocale()).format(num(global.activeMarketPairs)),null]].map(([label,value,delta])=>`<div class="intelligence-metric-row"><span>${label}</span><b>${value}${delta!=null?` <small class="${pctClass(num(delta))}">${fmtPct(num(delta))}</small>`:""}</b></div>`).join("");$("cmc100Change").textContent=fmtPct(cmc.change24h);$("cmc100Change").className=pctClass(num(cmc.change24h));const weights=(cmc.constituents||[]).slice().sort((a,b)=>num(b.weight)-num(a.weight));$("cmc100Metrics").innerHTML=`<div><span>${tr("VALORE INDICE")}</span><b>${num(cmc.value).toFixed(2)}</b></div><div><span>${tr("PESO TOP 5")}</span><b>${weights.slice(0,5).reduce((s,x)=>s+num(x.weight),0).toFixed(1)}%</b></div>`;$("cmc100Weights").innerHTML=weights.slice(0,6).map(x=>`<div class="exposure-bar"><span>${esc(x.symbol||x.name)}</span><div class="track"><div class="fill" style="width:${clamp(num(x.weight)*2)}%"></div></div><small>${num(x.weight).toFixed(1)}%</small></div>`).join("")||`<p class="muted">${tr("Costituenti non disponibili.")}</p>`}
const intelligenceEventStore="cryptoRadarIntelligenceEvents";
function intelligenceEvents(){const events=localData(intelligenceEventStore,[]);return Array.isArray(events)?events:[]}
function addIntelligenceEvent(){const title=$("intelEventTitle").value.trim(),date=$("intelEventDate").value,verification=$("intelEventVerification").value,source=$("intelEventSource").value.trim();if(!title||!date)return showError("Titolo e data dell’evento sono obbligatori.");if((source&&!/^https:\/\//i.test(source))||(verification!=="unverified"&&!source))return showError("Usa un URL HTTPS valido; è obbligatorio per una fonte ufficiale o confermata.");const events=intelligenceEvents();events.push({id:crypto.randomUUID(),title:title.slice(0,120),date,asset:$("intelEventAsset").value.trim().toUpperCase().slice(0,20),type:$("intelEventType").value,impact:$("intelEventImpact").value,verification,source:source.slice(0,500),notes:$("intelEventNotes").value.trim().slice(0,800),createdAt:new Date().toISOString()});saveLocalData(intelligenceEventStore,events);["intelEventTitle","intelEventAsset","intelEventSource","intelEventNotes"].forEach(id=>$(id).value="");renderIntelligenceEvents()}
function deleteIntelligenceEvent(id){saveLocalData(intelligenceEventStore,intelligenceEvents().filter(x=>x.id!==id));renderIntelligenceEvents()}
function renderIntelligenceEvents(){if(!$("intelEventList"))return;const own=intelligenceEvents(),calendar=(calendarState().events||[]).map(e=>({...e,id:`calendar-${e.id}`,verification:"unverified",origin:tr("Centro operativo")})),events=[...own,...calendar].sort((a,b)=>a.date.localeCompare(b.date)),today=localIsoDate(new Date()),upcoming=events.filter(e=>e.date>=today),official=events.filter(e=>e.verification==="official").length,unverified=events.filter(e=>e.verification==="unverified").length;$("intelEventCount").textContent=`${events.length} ${tr("eventi")} · ${upcoming.length} ${tr("futuri")}`;$("intelEventSummary").innerHTML=`<div><span>${tr("FUTURI")}</span><b>${upcoming.length}</b></div><div><span>${tr("FONTI UFFICIALI")}</span><b>${official}</b></div><div><span>${tr("DA VERIFICARE")}</span><b>${unverified}</b></div><div><span>${tr("IMPATTO ALTO")}</span><b>${events.filter(e=>e.impact==="high").length}</b></div>`;$("intelEventList").innerHTML=events.map(e=>{const d=new Date(`${e.date}T12:00:00`),status=e.verification||"unverified",label=tr(status==="official"?"fonte ufficiale":status==="secondary"?"fonte confermata":"da verificare");return `<article class="card intel-event"><div class="intel-event-date">${d.getDate()}<span>${d.toLocaleDateString(uiLocale(),{month:"short",year:"2-digit"})}</span></div><div class="intel-event-main"><b data-no-i18n>${esc(e.title)}</b><div class="intel-event-meta"><span class="source-status ${status}">${label}</span><span class="badge">${tr(e.type||"evento")}</span>${e.asset?`<span class="badge">${esc(e.asset)}</span>`:""}${e.impact?`<span class="badge ${e.impact==="high"?"alto":""}">${tr("impatto")} ${tr(e.impact)}</span>`:""}</div>${e.notes?`<small data-no-i18n>${esc(e.notes)}</small>`:""}${e.source?`<a href="${esc(e.source)}" target="_blank" rel="noopener noreferrer">${tr("Apri fonte ↗")}</a>`:`<small>${esc(e.origin||tr("Nessuna fonte registrata"))}</small>`}</div>${own.some(x=>x.id===e.id)?`<button class="journal-delete" data-delete-intel-event="${esc(e.id)}">${tr("Elimina")}</button>`:""}</article>`}).join("")||`<article class="card insight-card"><p class="muted">${tr("Nessun evento registrato. Inserisci il primo soltanto dopo aver controllato la fonte.")}</p></article>`;document.querySelectorAll("[data-delete-intel-event]").forEach(b=>b.onclick=()=>deleteIntelligenceEvent(b.dataset.deleteIntelEvent));window.CryptoRadarI18n?.translateDocument()}
function intelligenceAsset(position){const symbol=position.symbol?.toUpperCase();return (state.marketIntelligence?.assets||[]).find(x=>x.symbol?.toUpperCase()===symbol)}
function sectorFor(asset){const tags=(asset?.tags||[]).map(x=>x.toLowerCase()),has=(...terms)=>terms.some(term=>tags.some(tag=>tag.includes(term)));if(has("stablecoin"))return"Stablecoin";if(has("layer-1","mineable","pow","pos"))return"Layer 1";if(has("layer-2","scaling"))return"Layer 2";if(has("defi","yield","dex","lending"))return"DeFi";if(has("ai","big-data"))return"AI & Data";if(has("gaming","metaverse"))return"Gaming & Metaverse";if(has("meme"))return"Meme";if(has("oracle"))return"Oracle";if(has("exchange"))return"Exchange";if(has("real-world-assets","rwa"))return"RWA";if(has("privacy"))return"Privacy";if(has("payments","medium-of-exchange"))return"Pagamenti";return"Altro / da verificare"}
function platformFor(asset){
  const platform=asset?.platform?.trim();
  if(!platform)return tr("Da verificare");
  if(/\snative$/i.test(platform))return`${tr("Rete propria")} · ${asset.symbol?.toUpperCase()||platform.replace(/\snative$/i,"")}`;
  return platform;
}
function renderExposure(){
  if(!$("platformExposure"))return;
  const positions=activePositions(),total=positions.reduce((sum,position)=>sum+position.value,0);
  if(!total){
    $("exposureHeadline").innerHTML=`<div><span>VALORE ANALIZZATO</span><b>€0</b><small>quantità × prezzo corrente</small></div><div><span>POSIZIONI ATTIVE</span><b>0</b><small>compila almeno una quantità</small></div><div><span>COPERTURA DATI</span><b>—</b><small>in attesa del portafoglio</small></div><div><span>CONCENTRAZIONE</span><b>—</b><small>non ancora calcolabile</small></div>`;
    $("platformExposure").innerHTML=`<div class="exposure-empty"><b>Nessuna rete da confrontare</b><span>Aggiungi una quantità nel portafoglio. Il costo medio non è necessario per questa mappa.</span></div>`;
    $("sectorExposure").innerHTML=`<div class="exposure-empty"><b>Nessun tema da confrontare</b><span>Quando una posizione avrà valore, verrà raggruppata usando i metadati disponibili.</span></div>`;
    $("hiddenExposureWarnings").innerHTML=`<div class="risk-item exposure-warning"><b>Primo passaggio</b><span>Apri “Il mio portafoglio”, aggiungi le crypto possedute e inserisci almeno le quantità.</span></div>`;
    return;
  }
  const grouped=key=>{
    const groups={};
    positions.forEach(position=>{
      const asset=intelligenceAsset(position),label=key==="platform"?platformFor(asset):sectorFor(asset);
      groups[label]=(groups[label]||0)+position.value;
    });
    return Object.entries(groups).sort((a,b)=>b[1]-a[1]);
  };
  const bars=rows=>rows.map(([label,value])=>{
    const weight=value/total*100;
    return `<div class="exposure-bar" title="${esc(`${label}: ${fmtEur(value)} · ${weight.toFixed(1)}%`)}"><span><b>${esc(label)}</b><em>${fmtEur(value)}</em></span><div class="track"><div class="fill" style="width:${weight}%"></div></div><small>${weight.toFixed(1)}%</small></div>`;
  }).join("");
  const platforms=grouped("platform"),sectors=grouped("sector"),largest=positions.slice().sort((a,b)=>b.value-a.value)[0],altWeight=positions.filter(position=>!["BTC","ETH"].includes(position.symbol?.toUpperCase())&&!stableSymbols.has(position.symbol?.toLowerCase())).reduce((sum,position)=>sum+position.value,0)/total*100,unmapped=positions.filter(position=>!intelligenceAsset(position)),mappedValue=positions.filter(position=>intelligenceAsset(position)).reduce((sum,position)=>sum+position.value,0),coverage=total?mappedValue/total*100:0,topPlatformWeight=platforms[0]?.[1]/total*100||0;
  $("platformExposure").innerHTML=bars(platforms);
  $("sectorExposure").innerHTML=bars(sectors);
  $("exposureHeadline").innerHTML=`<div><span>VALORE ANALIZZATO</span><b>${fmtEur(total)}</b><small>quantità × prezzo corrente</small></div><div><span>POSIZIONI ATTIVE</span><b>${positions.length}</b><small>con valore disponibile</small></div><div><span>COPERTURA DATI</span><b>${coverage.toFixed(0)}%</b><small>${positions.length-unmapped.length}/${positions.length} posizioni classificate</small></div><div><span>GRUPPO PRINCIPALE</span><b>${topPlatformWeight.toFixed(1)}%</b><small>${esc(platforms[0]?.[0]||tr("Da verificare"))}</small></div>`;
  const warnings=[];
  if(platforms[0]?.[1]/total>.5)warnings.push(`Il ${Math.round(platforms[0][1]/total*100)}% dipende da “${platforms[0][0]}”. Verifica rischi comuni di rete, bridge, congestione e infrastruttura.`);
  if(sectors[0]?.[1]/total>.55)warnings.push(`Il tema “${sectors[0][0]}” concentra il ${Math.round(sectors[0][1]/total*100)}% del valore. Controlla se più token dipendono dalla stessa tesi.`);
  if(largest?.value/total>.35)warnings.push(`${largest.symbol} pesa ${(largest.value/total*100).toFixed(1)}%. Molte posizioni piccole non compensano una singola posizione dominante.`);
  if(altWeight>70)warnings.push(`Le altcoin rappresentano ${altWeight.toFixed(1)}%. Nei periodi difficili possono muoversi insieme più del previsto.`);
  if(unmapped.length)warnings.push(`${unmapped.map(position=>position.symbol).join(", ")}: metadati non disponibili nel campione. Verifica manualmente rete, funzione e dipendenze.`);
  $("hiddenExposureWarnings").innerHTML=(warnings.length?warnings:["Nessuna soglia interna è stata superata. Controlla comunque correlazioni, bridge, custodia e stablecoin: questa mappa non copre ogni rischio."]).map((text,index)=>`<div class="risk-item ${warnings.length?'warn':'rule-ok'} exposure-warning"><b>${warnings.length?`${tr("Controllo")} ${index+1}`:tr("Nessuna concentrazione evidente")}</b><span>${esc(text)}</span></div>`).join("");
}
const stressPresets={broad:{btc:-30,eth:-40,alt:-55,stable:0},altcoin:{btc:-15,eth:-25,alt:-45,stable:0},depeg:{btc:0,eth:0,alt:0,stable:-10}};
function setIntelStress(name){document.querySelectorAll("[data-intel-stress]").forEach(x=>x.classList.toggle("active",x.dataset.intelStress===name));const preset=stressPresets[name];if(preset){$("intelStressBtc").value=preset.btc;$("intelStressEth").value=preset.eth;$("intelStressAlt").value=preset.alt;$("intelStressStable").value=preset.stable}renderIntelStress()}
function renderIntelStress(){if(!$("intelStressMetrics"))return;const positions=activePositions(),total=positions.reduce((s,p)=>s+p.value,0),shocks={btc:clamp(num($("intelStressBtc").value),-100,100),eth:clamp(num($("intelStressEth").value),-100,100),alt:clamp(num($("intelStressAlt").value),-100,100),stable:clamp(num($("intelStressStable").value),-100,100)},rows=positions.map(p=>{const sym=p.symbol?.toLowerCase(),group=sym==="btc"?"btc":sym==="eth"?"eth":stableSymbols.has(sym)?"stable":"alt",shock=shocks[group],impact=p.value*shock/100;return {...p,group,shock,impact}}).sort((a,b)=>a.impact-b.impact),impact=rows.reduce((s,p)=>s+p.impact,0),projected=Math.max(0,total+impact),lossPct=total?impact/total*100:0,limit=num(state.plan?.maxToleratedLoss);$("intelStressMetrics").innerHTML=`<article class="card metric"><span>${tr("Valore attuale")}</span><strong>${fmtEur(total)}</strong><small>${positions.length} ${tr("posizioni")}</small></article><article class="card metric"><span>${tr("Valore nello scenario")}</span><strong>${fmtEur(projected)}</strong><small>${tr("ipotesi statica")}</small></article><article class="card metric"><span>${tr("Impatto stimato")}</span><strong class="${pctClass(impact)}">${fmtEur(impact)}</strong><small>${fmtPct(lossPct)}</small></article><article class="card metric"><span>${tr("Perdita tollerabile")}</span><strong>${limit?`${limit.toFixed(0)}%`:"—"}</strong><small>${tr("Piano personale")}</small></article>`;const max=Math.max(1,...rows.map(x=>Math.abs(x.impact)));$("intelStressContributions").innerHTML=rows.map(p=>`<div class="exposure-bar"><span>${esc(p.symbol)} · ${p.shock}%</span><div class="track"><div class="fill" style="width:${Math.abs(p.impact)/max*100}%"></div></div><small>${fmtEur(p.impact)}</small></div>`).join("")||`<p class="muted">${tr("Compila il portafoglio per eseguire lo scenario.")}</p>`;const plan=[];if(!total)plan.push(tr("Manca un portafoglio valorizzato: lo scenario non può essere calcolato."));else if(!limit)plan.push(tr("Imposta la perdita tollerabile nel Piano personale per avere un confronto."));else if(Math.abs(lossPct)>limit)plan.push(`${tr("Lo scenario supera il limite dichiarato di")} ${(Math.abs(lossPct)-limit).toFixed(1)} ${tr("punti percentuali")}.`);else plan.push(`${tr("Lo scenario resta entro il limite dichiarato con un margine di")} ${(limit-Math.abs(lossPct)).toFixed(1)} ${tr("punti")}.`);if(rows[0])plan.push(`${rows[0].symbol} · ${tr("contributo maggiore")}: ${fmtEur(rows[0].impact)}.`);plan.push(tr("Ripeti con shock più severi: il caso reale può includere perdita totale o illiquidità."));$("intelStressPlan").innerHTML=plan.map((x,i)=>`<div class="risk-item ${i===0&&limit&&Math.abs(lossPct)>limit?'danger':i===0&&total?'rule-ok':''}">${esc(x)}</div>`).join("")}
function taxIntegrityCalculation(){const tx=state.transactions||[],known=new Set(["buy","sell","deposit","withdrawal","reward","fee","trade"]),issues=[];let unknown=0,missing=0,missingCost=0,feeGaps=0;tx.forEach((t,index)=>{if(!known.has(t.type)){unknown++;if(unknown<=4)issues.push(`Riga ${t.sourceRow||index+1}: tipo “${t.type||'vuoto'}” da classificare.`)}if(!t.timestamp||!t.asset||(t.amount==null&&t.quoteAmount==null)){missing++;if(missing<=4)issues.push(`Riga ${t.sourceRow||index+1}: data, asset o importo incompleto.`)}if(["buy","sell","trade"].includes(t.type)&&t.price==null&&t.quoteAmount==null){missingCost++;if(missingCost<=4)issues.push(`${t.asset||'Asset'} ${t.timestamp||''}: controvalore/prezzo non documentato.`)}if(t.feeAmount==null&&["buy","sell","trade"].includes(t.type))feeGaps++});const deposits=tx.filter(t=>t.type==="deposit"),withdrawals=tx.filter(t=>t.type==="withdrawal"),used=new Set(),unmatched=withdrawals.filter(w=>{const wt=Date.parse(w.timestamp),match=deposits.find((d,i)=>!used.has(i)&&d.asset===w.asset&&Math.abs(num(d.amount)-num(w.amount))/Math.max(num(w.amount),1e-12)<.02&&(!Number.isFinite(wt)||!Number.isFinite(Date.parse(d.timestamp))||Math.abs(Date.parse(d.timestamp)-wt)<=7*864e5));if(match){used.add(deposits.indexOf(match));return false}return true}).length;return{total:tx.length,unknown,missing,missingCost,feeGaps,unmatched,issues}}
function renderTaxIntegrity(){if(!$("intelTaxMetrics"))return;const c=taxIntegrityCalculation(),declared=taxReadinessState(),declaredCalc=taxReadinessCalculation(declared),technical=c.unknown+c.missing+c.missingCost+c.unmatched;$("intelTaxMetrics").innerHTML=`<article class="card metric"><span>${tr("Operazioni importate")}</span><strong>${c.total}</strong><small>${tr("registro locale/server")}</small></article><article class="card metric"><span>${tr("Anomalie tecniche")}</span><strong>${technical}</strong><small>${tr("campi, tipi e abbinamenti")}</small></article><article class="card metric"><span>${tr("Trasferimenti da abbinare")}</span><strong>${c.unmatched}</strong><small>${tr("euristica ±2% / 7 giorni")}</small></article><article class="card metric"><span>${tr("Preparazione dichiarata")}</span><strong>${declaredCalc.score}%</strong><small>${tr("Assistente Personale · Fisco continuo")}</small></article>`;const issues=[...c.issues];if(c.unmatched)issues.push(`${c.unmatched} ${tr("prelievi non hanno un deposito simile entro 7 giorni; verifica indirizzi, fee e trasferimenti interni.")}`);if(c.feeGaps)issues.push(`${c.feeGaps} ${tr("operazioni non riportano una commissione; controlla se era zero o assente nell’export.")}`);if(!c.total)issues.push(tr("Nessuna operazione importata: collega la cronologia completa di ogni exchange e wallet."));$("intelTaxIssues").innerHTML=issues.slice(0,12).map(x=>`<div class="risk-item warn">${esc(x)}</div>`).join("")||`<div class="risk-item rule-ok">${tr("Nessuna anomalia tecnica rilevata nei campi disponibili. La classificazione fiscale resta da verificare.")}</div>`;const evidence=[tr("CSV originali e conferme degli exchange, senza modificarli."),tr("Hash transazione e indirizzi per depositi, prelievi e trasferimenti propri."),tr("Prova del costo in euro, data/ora, quantità e commissioni."),tr("Estratti wallet, ricompense, staking, airdrop e operazioni DeFi/NFT."),tr("Criterio di calcolo, cambi utilizzati, riconciliazione e versioni dei report."),tr("Dichiarazioni, F24, ricevute telematiche e comunicazioni del professionista.")];$("intelTaxEvidence").innerHTML=evidence.map(x=>`<div class="risk-item">${esc(x)}</div>`).join("")}
function briefModel(){
  const data=state.marketIntelligence||{},positions=activePositions().sort((a,b)=>b.value-a.value),total=positions.reduce((s,p)=>s+p.value,0),events=intelligenceEvents().filter(e=>e.date>=localIsoDate(new Date())).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,4),tax=taxIntegrityCalculation(),fear=num(data.fearGreed?.value),alt=num(data.altcoinSeason?.altcoin_index),largest=positions[0],newsSymbols=new Set(positions.map(p=>p.symbol?.toUpperCase())),relevant=state.news.filter(n=>[...newsSymbols].some(s=>`${n.title} ${n.summary||''}`.toUpperCase().includes(s))).slice(0,3),na=tr("non disponibile");
  return{date:new Date(),sections:[
    {title:tr("Mercato"),items:data?[`${tr("Paura e avidità")}: ${fear||na}${fear?` · ${fearLabel(fear)}`:""}.`,`${tr("Stagione delle altcoin")}: ${alt||na} · ${tr("dominanza BTC")} ${data.global?.btcDominance!=null?num(data.global.btcDominance).toFixed(1)+"%":na}.`,`CMC100 24h ${data.cmc100?.change24h!=null?fmtPct(num(data.cmc100.change24h)):na} · ${tr("capitalizzazione globale")} ${data.global?.totalMarketCap?fmtEur(data.global.totalMarketCap,true):na}.`]:[tr("Indici aggregati non disponibili.")]},
    {title:tr("Portafoglio"),items:positions.length?[`${tr("Valore indicativo")}: ${fmtEur(total)} · ${positions.length} ${tr("posizioni")}.`,`${largest.symbol} · ${tr("posizione maggiore")}: ${(largest.value/total*100).toFixed(1)}%.`,...positions.slice(0,3).map(p=>`${p.symbol}: ${fmtEur(p.value)} · 24h ${fmtPct(change(p.coin,"24h"))}.`)]:[tr("Portafoglio non compilato.")]},
    {title:tr("Eventi documentati"),items:events.length?events.map(e=>`${e.date} · ${e.asset||tr("Mercato")} · ${e.title} · ${tr(e.verification)}.`):[tr("Nessun evento futuro registrato con provenienza.")]},
    {title:tr("Notizie collegate"),items:relevant.length?relevant.map(n=>n.title):[tr("Nessuna notizia caricata collegata direttamente ai simboli in portafoglio.")]},
    {title:tr("Dati e disciplina"),items:[`${tax.total} ${tr("operazioni importate")} · ${tax.unknown+tax.missing+tax.missingCost+tax.unmatched} ${tr("anomalie tecniche")}.`,state.plan?.maxToleratedLoss?`${tr("Perdita tollerabile dichiarata")} ${num(state.plan.maxToleratedLoss).toFixed(0)}% · ${tr("singola crypto massimo")} ${num(state.plan.maxSingleCoin).toFixed(0)}%.`:tr("Limiti personali incompleti: aggiorna il Piano personale.")]}
  ]}
}
function briefText(model=briefModel()){return[`CRYPTO RADAR · BRIEF · ${model.date.toLocaleString(uiLocale())}`,...model.sections.flatMap(s=>["",s.title.toUpperCase(),...s.items.map(x=>`- ${x}`)]),"",tr("Contenuto informativo in sola lettura. Nessuna raccomandazione, previsione o calcolo fiscale certificato.")].join("\n")}
function renderBrief(){if(!$("intelBriefContent"))return;const model=briefModel();$("intelBriefDate").textContent=model.date.toLocaleString(uiLocale(),{weekday:"long",day:"2-digit",month:"long",year:"numeric",hour:"2-digit",minute:"2-digit"});$("intelBriefContent").innerHTML=model.sections.map(s=>`<section class="brief-section"><h3>${esc(s.title)}</h3><ul>${s.items.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section>`).join("")+`<p class="brief-footer">${esc(tr("Generato localmente dai dati disponibili. Controlla timestamp, fonti e documenti originali."))}</p>`}
function renderIntelligence(){if(!$("intelligence"))return;renderTemperature();renderIntelligenceEvents();renderExposure();renderIntelStress();renderTaxIntegrity();renderBrief();window.CryptoRadarI18n?.translateDocument()}
function renderAdvanced(){renderExecutionSelector();renderAdvancedRisk();if(!$("micaRegistryStats").children.length)loadMicaRegistryStats()}
function renderExecutionSelector(){if(!state.scored.length)return;syncCatalogPicker("execution")}
async function runExecutionLab(){const button=$("runExecution"),coin=coinById($("executionCoin").value),symbol=coin?.symbol?.toUpperCase(),amount=Math.max(10,num($("executionAmount").value)),side=$("executionSide").value,fee=clamp(num($("executionFee").value),0,10);if(!symbol){showError("Seleziona una crypto da confrontare.");return}button.disabled=true;button.textContent="Confronto prezzi in corso…";$("executionResults").innerHTML=`<article class="card insight-card"><p class="muted">Lettura dei prezzi e della liquidità disponibile…</p></article>`;try{const data=await api(`/api/execution?symbol=${encodeURIComponent(symbol)}&amount=${amount}&side=${side}`),stamp=new Date(data.asOf*1000).toLocaleString("it-IT");$("executionMeta").textContent=`${symbol}/EUR · ${side==="buy"?"acquisto":"vendita"} · ${fmtEur(amount)} · fotografia ${stamp}`;$("executionResults").innerHTML=(data.books||[]).map((book,index)=>{const feeEur=amount*fee/100,total=side==="buy"?amount+feeEur:amount-feeEur;return `<article class="card execution-card ${index===0&&book.fillPct>=99.9?'best':''}"><div class="execution-source"><h3>${esc(book.source)}</h3><small>${book.levelsUsed} livelli di prezzo</small></div><div class="execution-price">${fmtEur(book.vwap)}</div><small>Prezzo medio indicativo · totale dopo commissione ${fmtEur(total)}</small><div class="execution-stats"><div><span>SPREAD</span><b>${num(book.spreadBps).toFixed(1)} bps</b></div><div><span>SLIPPAGE</span><b class="${book.slippageBps>30?'negative':book.slippageBps>10?'neutral':'positive'}">${num(book.slippageBps).toFixed(1)} bps</b></div><div><span>FILL · COPERTURA</span><b>${num(book.fillPct).toFixed(1)}%</b></div><div><span>LIQUIDITÀ VISIBILE</span><b>${fmtEur(book.depthEur,true)}</b></div></div></article>`}).join("")+(data.errors||[]).map(item=>`<div class="execution-error"><b>${esc(item.source)}</b><span> · coppia EUR o dati non disponibili</span></div>`).join("");if(!(data.books||[]).length)$("executionResults").innerHTML=`<div class="risk-item danger">Nessun exchange ha restituito prezzi utilizzabili per ${esc(symbol)}/EUR. La crypto è presente nel catalogo, ma la coppia EUR può non essere disponibile sulle fonti confrontate.</div>`}catch(error){$("executionResults").innerHTML=`<div class="risk-item danger">${esc(error.message)}</div>`}finally{button.disabled=false;button.textContent="Confronta i costi";window.CryptoRadarI18n?.translateDocument()}}
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:0;
let advancedRiskSeries={},advancedRiskSeriesLoaded=false,advancedRiskSeriesLoading=false;
function covariance(a,b){const n=Math.min(a.length,b.length);if(n<2)return 0;const aa=a.slice(-n),bb=b.slice(-n),ma=mean(aa),mb=mean(bb);return aa.reduce((sum,x,i)=>sum+(x-ma)*(bb[i]-mb),0)/(n-1)}
function standardDeviation(values){return Math.sqrt(Math.max(0,covariance(values,values)))}
function coinReturns(coin){const prices=(advancedRiskSeries[coin?.symbol?.toUpperCase()]||coin?.sparkline_in_7d?.price||[]).filter(x=>num(x)>0);return prices.slice(1).map((price,index)=>Math.log(price/prices[index])).filter(Number.isFinite)}
function correlation(a,b){const denominator=standardDeviation(a)*standardDeviation(b);return denominator?clamp(covariance(a,b)/denominator,-1,1):0}
function advancedRiskCalculation(){const positions=activePositions(),total=positions.reduce((sum,p)=>sum+p.value,0);if(!positions.length||!total)return null;const assets=positions.map(p=>({...p,weight:p.value/total,returns:coinReturns(p.coin)})).filter(p=>p.returns.length>=24),length=Math.min(...assets.map(p=>p.returns.length));if(!assets.length||!Number.isFinite(length))return null;assets.forEach(p=>p.returns=p.returns.slice(-length));const portfolioReturns=Array.from({length},(_,i)=>assets.reduce((sum,p)=>sum+p.weight*p.returns[i],0)),portVar=covariance(portfolioReturns,portfolioReturns),annualVol=Math.sqrt(portVar)*Math.sqrt(24*365)*100,btcReturns=coinReturns(coinById("bitcoin")).slice(-length),beta=covariance(portfolioReturns,btcReturns)/(covariance(btcReturns,btcReturns)||1),pairs=[];for(let i=0;i<assets.length;i++)for(let j=i+1;j<assets.length;j++)pairs.push(correlation(assets[i].returns,assets[j].returns));const effective=1/assets.reduce((sum,p)=>sum+p.weight**2,0),rolling24=[];for(let i=23;i<portfolioReturns.length;i++)rolling24.push(Math.exp(portfolioReturns.slice(i-23,i+1).reduce((a,b)=>a+b,0))-1);const sorted=[...rolling24].sort((a,b)=>a-b),var95=sorted.length?-sorted[Math.max(0,Math.floor(sorted.length*.05))]*100:0;let wealth=1,peak=1,maxDrawdown=0;portfolioReturns.forEach(r=>{wealth*=Math.exp(r);peak=Math.max(peak,wealth);maxDrawdown=Math.min(maxDrawdown,wealth/peak-1)});assets.forEach(p=>p.riskContribution=portVar?p.weight*covariance(p.returns,portfolioReturns)/portVar*100:0);return {assets,portfolioReturns,annualVol,beta,averageCorrelation:mean(pairs),effective,var95,maxDrawdown:maxDrawdown*100}}
async function loadAdvancedRiskSeries(){
  const positions=activePositions(),symbols=[...new Set(["BTC",...positions.map(position=>position.symbol).filter(Boolean)])];
  if(!positions.length||advancedRiskSeriesLoading)return;
  advancedRiskSeriesLoading=true;$("advancedRiskMetrics").innerHTML=`<article class="card insight-card"><p class="muted">Caricamento delle serie orarie pubbliche per il portafoglio…</p></article>`;
  try{const data=await api(`/api/risk-series?symbols=${encodeURIComponent(symbols.join(","))}`);advancedRiskSeries=data.series||{};advancedRiskSeriesLoaded=true;$("advancedRiskWarnings").innerHTML=`<div class="risk-item">Fonte serie: ${esc(data.source)} · intervallo ${esc(data.interval)} · ${new Date(data.asOf*1000).toLocaleString(uiLocale())}.</div>`}
  catch(error){advancedRiskSeriesLoaded=true;$("advancedRiskWarnings").innerHTML=`<div class="risk-item danger">${esc(error.message)}</div>`}
  finally{advancedRiskSeriesLoading=false;renderAdvancedRisk()}
}
function renderAdvancedRisk(){if(!$("advancedRiskMetrics"))return;const positions=activePositions(),r=advancedRiskCalculation();if(!r){if(positions.length&&!advancedRiskSeriesLoaded){loadAdvancedRiskSeries();return}$("advancedRiskMetrics").innerHTML=`<article class="card insight-card"><p class="muted">${positions.length?"Le fonti disponibili non hanno restituito abbastanza storico per queste coppie EUR.":"Aggiungi quantità e prezzo medio ad almeno una posizione per attivare il Risk Engine."}</p></article>`;$("riskCorrelationMatrix").innerHTML="";$("riskContribution").innerHTML="";if(!positions.length)$("advancedRiskWarnings").innerHTML=`<div class="risk-item">Il calcolo resta inattivo finché il portafoglio non contiene valori positivi.</div>`;return}$("advancedRiskMetrics").innerHTML=`<article class="card metric"><span>Volatilità annualizzata</span><strong>${r.annualVol.toFixed(1)}%</strong><small>stimata su rendimenti orari recenti</small></article><article class="card metric"><span>Beta rispetto a BTC</span><strong>${r.beta.toFixed(2)}</strong><small>sensibilità recente</small></article><article class="card metric"><span>Posizioni effettive</span><strong>${r.effective.toFixed(1)}</strong><small>su ${r.assets.length} posizioni valorizzate</small></article><article class="card metric"><span>Perdita storica 95%</span><strong>${r.var95.toFixed(1)}%</strong><small>proxy 24h, non perdita massima</small></article>`;const color=value=>value>.7?'rgba(255,113,133,.55)':value>.3?'rgba(242,198,109,.4)':value>-.2?'rgba(121,169,255,.28)':'rgba(115,226,167,.4)';$("riskCorrelationMatrix").innerHTML=`<table><thead><tr><th></th>${r.assets.map(a=>`<th>${esc(a.symbol)}</th>`).join("")}</tr></thead><tbody>${r.assets.map(a=>`<tr><th>${esc(a.symbol)}</th>${r.assets.map(b=>{const value=a.id===b.id?1:correlation(a.returns,b.returns);return `<td><span class="correlation-cell" style="background:${color(value)}">${value.toFixed(2)}</span></td>`}).join("")}</tr>`).join("")}</tbody></table>`;$("riskContribution").innerHTML=r.assets.sort((a,b)=>b.riskContribution-a.riskContribution).map(a=>`<div><span>${esc(a.symbol)} · peso ${(a.weight*100).toFixed(1)}%</span><div class="bar-track"><div class="bar-fill" style="width:${clamp(a.riskContribution)}%"></div></div><b>${a.riskContribution.toFixed(1)}%</b></div>`).join("");const warnings=[];if(r.averageCorrelation>.65)warnings.push("Le posizioni si sono mosse insieme: il numero di token sovrastima la diversificazione.");if(r.effective<Math.max(1.5,r.assets.length*.55))warnings.push("La concentrazione riduce sensibilmente il numero di posizioni effettive.");if(r.beta>1.2)warnings.push("Il portafoglio ha mostrato sensibilità superiore a BTC nel periodo osservato.");if(r.maxDrawdown<-10)warnings.push(`Drawdown intraperiodo ricostruito: ${r.maxDrawdown.toFixed(1)}%.`);$("advancedRiskWarnings").innerHTML=(warnings.length?warnings:["Nessuna criticità strutturale forte nei dati recenti; verifica comunque scenari più lunghi e condizioni di liquidità."]).map(x=>`<div class="risk-item ${warnings.length?'warn':'rule-ok'}">${esc(x)}</div>`).join("");window.CryptoRadarI18n?.translateDocument()}
async function loadMicaRegistryStats(){try{const data=await api("/api/mica-search");renderMicaData(data,false)}catch(error){$("micaRegistryStats").innerHTML=`<div class="risk-item danger">${esc(error.message)}</div>`}}
async function runMicaSearch(){const query=$("micaQuery").value.trim();if(query.length<2){showError("Inserisci almeno due caratteri per cercare nel registro MiCA.");return}const button=$("runMicaSearch");button.disabled=true;button.textContent="Consultazione ESMA…";try{renderMicaData(await api(`/api/mica-search?q=${encodeURIComponent(query)}`),true)}catch(error){$("micaResults").innerHTML=`<div class="risk-item danger">${esc(error.message)}</div>`}finally{button.disabled=false;button.textContent="Cerca nei registri";window.CryptoRadarI18n?.translateDocument()}}
function renderMicaData(data,showResults){$("micaRegistryStats").innerHTML=`<div><span>CASP AUTORIZZATI</span><b>${num(data.counts?.authorised)}</b></div><div><span>NON CONFORMI</span><b>${num(data.counts?.nonCompliant)}</b></div>`;$("micaSearchMeta").textContent=`Fonte: ${data.source} · consultata ${new Date(data.asOf*1000).toLocaleString("it-IT")} · verifica sempre il CSV originale.`;if(!showResults)return;const card=item=>`<article class="card mica-card"><div><span class="mica-status ${esc(item.status)}">${item.status==="authorised"?"Autorizzato":"Non conforme"}</span><h3>${esc(item.commercialName||item.legalName||"Nome non disponibile")}</h3><small>${esc(item.country||"—")} · ${esc(item.lastUpdate||item.decisionDate||"data non disponibile")}</small></div><div><b>${esc(item.legalName||"")}</b><p>${esc(item.authority||"")}</p>${item.website?`<a href="${esc(item.website.split("|")[0])}" target="_blank" rel="noopener noreferrer">${esc(item.website)}</a>`:""}${item.services?`<p class="mica-services">${esc(item.services)}</p>`:""}${item.reason?`<p>${esc(item.reason)}</p>`:""}</div><div>${item.authorisationEnd?`<span class="badge alto">Fine ${esc(item.authorisationEnd)}</span>`:`<span class="badge ${item.status==="authorised"?'basso':'alto'}">${item.status==="authorised"?'Registro CASP':'Lista avvisi'}</span>`}</div></article>`;const good=data.authorised||[],bad=data.nonCompliant||[];$("micaResults").innerHTML=`<div class="mica-group-title"><h2>Operatori autorizzati</h2><span>${good.length} corrispondenze</span></div>${good.map(card).join("")||`<div class="risk-item">Nessuna corrispondenza nel registro CASP.</div>`}<div class="mica-group-title"><h2>Entità non conformi</h2><span>${bad.length} corrispondenze</span></div>${bad.map(card).join("")||`<div class="risk-item">Nessuna corrispondenza nella lista ESMA dei soggetti non conformi.</div>`}`;window.CryptoRadarI18n?.translateDocument()}
function renderCopilot(){if(!state.scored.length)return;renderCopilotSelector();renderPassports();renderMonthlyBehavior();renderFiscalReadiness();renderScoreChanges();renderBehaviorScore();renderPrivacy();renderDataQuality();checkCooldown()}
const tutorContent={overview:["Leggere la Panoramica","Il regime descrive il contesto; le posizioni fissate sono personali. Apri una scheda per capire score e rischio, poi passa dall’Assistente Personale prima di agire.",[["Personalizza Home","overview"],["Assistente Personale","copilot"]]],screener:["Usare lo screener","Filtra per liquidità e dimensione. Prezzo unitario basso non significa convenienza: confronta market cap, FDV/MC, rischio e fonti.",[["Apri Metodo","method"],["Guide di analisi","academy"]]],portfolio:["Compilare il portafoglio","Quantità e costo medio servono per valore, P/L e concentrazione. Il risultato mostrato non è un calcolo fiscale certificato.",[["Piano personale","plan"],["Laboratorio","decision"]]],connections:["Importare senza perdere dati","Usa la cronologia completa, controlla anteprima e duplicati, quindi abbina depositi e prelievi tra wallet propri.",[["Fisco continuo","copilot"],["Guida fiscale","tax"]]],academy:["Percorso guidato","Completa i moduli in ordine oppure usa l’indice. Il progresso aumenta il punteggio di disciplina, non attribuisce competenze professionali.",[["Inizia dalle basi","academy"]]],plan:["Definire limiti prima del mercato","Capitale, perdita tollerabile e concentrazione devono essere sostenibili. Il piano è un vincolo decisionale, non una previsione.",[["Assistente Personale","copilot"]]],copilot:["Usare l’Assistente Personale","Compila tesi, invalidazione e fonti; risolvi gli avvisi prima di salvare il Passaporto. Il semaforo valuta il processo, non dice di comprare.",[["Laboratorio","decision"],["Guida fiscale","tax"]]],decision:["Laboratorio","Confronta la scelta col piano, simula uno shock e salva il ragionamento. “Osservazione” permette di documentare senza operare.",[["Controllo più completo","copilot"]]],operations:["Centro operativo","Gli alert richiedono indagine, il report crea memoria, il paper trading fa pratica e il calendario protegge la routine.",[["Guide dettagliate","academy"]]],advanced:["Strumenti avanzati","Costo operazione confronta prezzi e liquidità: leggi prima Fill, poi VWAP e Slippage. Risk Engine misura il portafoglio nel suo insieme e Verifica MiCA consulta i registri ESMA.",[["Intelligence Hub","intelligence"],["Metodo e limiti","method"]]],intelligence:["Intelligence Hub","Nella scheda Esposizioni controlla prima copertura dati, poi reti e temi. Le percentuali usano il valore corrente e gli avvisi indicano cosa approfondire, non cosa vendere.",[["Manuale completo","academy"],["Modifica portafoglio","portfolio"]]],news:["Leggere le notizie","Apri la fonte originale, verifica data ed evento e separa attenzione del mercato da qualità del progetto.",[["Guida alle fonti","academy"]]],tax:["Fiscalità italiana","Parti dall’anno corretto, riconcilia tutte le fonti e conserva prova dei costi. Per i casi concreti usa istruzioni annuali e professionista.",[["Indicatore continuo","copilot"]]],method:["Capire lo score","Lo score combina momentum, liquidità, tokenomics e rischio quantitativo. Serve a ordinare approfondimenti, non è una raccomandazione.",[["Variazioni score","copilot"]]],detail:["Dettaglio crypto","Confronta timeframe, volume, diluizione e motivazioni. Un grafico non sostituisce utilità, tokenomics e sicurezza.",[["Prima di comprare","copilot"]]]};
function renderTutor(){const [title,body,actions]=tutorContent[state.currentPage]||tutorContent.overview;$("tutorTitle").textContent=title;$("tutorBody").innerHTML=`<p>${esc(body)}</p><div class="tutor-rule"><b>Domanda guida</b><span>Quale informazione manca prima di poter spiegare questa scelta a un’altra persona?</span></div>`;$("tutorActions").innerHTML=actions.map(([label,page])=>`<button class="secondary" data-tutor-go="${esc(page)}">${esc(label)}</button>`).join("");document.querySelectorAll("[data-tutor-go]").forEach(b=>b.onclick=()=>{showPage(b.dataset.tutorGo);toggleTutor(false)})}
tutorContent.community=["Usare Chat Community","Nel Live fai domande brevi; nella Bacheca pubblica analisi verificabili. Seguire una strategia significa monitorarne tesi e invalidazione, non copiarla.",[["Apri Assistente Personale","copilot"],["Leggi il Metodo","method"]]];
function toggleTutor(open){$("tutorDrawer").classList.toggle("open",open);$("tutorDrawer").setAttribute("aria-hidden",String(!open));if(open)renderTutor()}

function renderOperations(){renderAlerts();renderWeeklyReport();renderPaper();renderCalendar()}

const communityIdentityStore="cryptoRadarCommunityIdentity";
let communityPollTimer=null,communityProfileSync=null,communityMessageRendered=0,communityMessageAttachment=null,communityPostAttachment=null;
function communityIdentity(){let identity=localData(communityIdentityStore,null);if(!identity?.id){identity={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`};saveLocalData(communityIdentityStore,identity)}return identity}
function communityProfiles(){return new Map((state.community.profiles||[]).map(profile=>[profile.id,profile]))}
function ownCommunityProfile(){return communityProfiles().get(communityIdentity().id)||null}
function communityInitials(name){return String(name||"CR").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join("").toUpperCase()||"CR"}
function communityHandle(name){return String(name||"utente").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"").slice(0,20)||`utente_${communityIdentity().id.slice(0,5)}`}
function communityUniqueHandle(name){const identity=communityIdentity(),suffix=identity.id.replace(/[^a-z0-9]/gi,"").slice(0,5).toLowerCase()||"user";return`${communityHandle(name).slice(0,14)}_${suffix}`.slice(0,20)}
function communityProfileDraft(){const identity=communityIdentity(),current=ownCommunityProfile(),local=localProfile(),displayName=String(local.name||current?.displayName||"").trim().slice(0,40);if(displayName.length<2)return null;if(!local.name&&current?.displayName)saveLocalData(copilotStore.profile,{...local,name:displayName,updatedAt:new Date().toISOString()});return{userId:identity.id,displayName,handle:current?.handle||communityUniqueHandle(displayName),experience:local.experience||current?.experience||"beginner",focus:current?.focus||[],bio:current?.bio||""}}
function communityProfileMatches(profile,draft){return profile?.displayName===draft.displayName&&profile?.handle===draft.handle&&profile?.experience===draft.experience}
async function syncCommunityProfile(required=false){const current=ownCommunityProfile(),draft=communityProfileDraft();if(!draft){if(required){openOnboarding();setTimeout(()=>$("onboardingName").focus(),0);showError("Per entrare nella Chat Community, scegli prima il tuo username pubblico.")}return null}if(communityProfileMatches(current,draft))return current;if(communityProfileSync)return communityProfileSync;communityProfileSync=api("/api/community/profile",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(draft)}).then(profile=>{state.community.profiles=[...(state.community.profiles||[]).filter(item=>item.id!==profile.id),profile];return profile}).finally(()=>communityProfileSync=null);return communityProfileSync}
async function requireCommunityProfile(){try{return Boolean(await syncCommunityProfile(true))}catch(error){showError(error.message||"Impossibile preparare il profilo Community.");return false}}
function communityRelativeTime(timestamp){const seconds=Math.max(0,Math.floor(Date.now()/1000-num(timestamp)));if(seconds<60)return"ora";if(seconds<3600)return`${Math.floor(seconds/60)} min`;if(seconds<86400)return`${Math.floor(seconds/3600)} h`;return new Date(num(timestamp)*1000).toLocaleDateString(uiLocale(),{day:"2-digit",month:"short"})}
function communityExperience(value){return {beginner:"Sta imparando",intermediate:"Intermedio",advanced:"Avanzato"}[value]||"Sta imparando"}
function communityKind(value){return {analysis:"Analisi",strategy:"Carta Strategia",question:"Domanda",lesson:"Lezione"}[value]||"Analisi"}
function communityTimeframe(value){return {intraday:"Intraday",week:"1-4 settimane",month:"1-6 mesi","long-term":"Oltre 6 mesi","not-set":"Orizzonte aperto"}[value]||"Orizzonte aperto"}
function communityRisk(value){return {low:"Rischio basso relativo",medium:"Rischio medio",high:"Rischio alto","not-assessed":"Rischio da valutare"}[value]||"Rischio da valutare"}
async function communityImageSource(file){
  if(window.createImageBitmap)return createImageBitmap(file);
  return new Promise((resolve,reject)=>{const url=URL.createObjectURL(file),image=new Image();image.onload=()=>{URL.revokeObjectURL(url);resolve(image)};image.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Immagine non leggibile."))};image.src=url});
}
async function prepareCommunityImage(file){
  if(!file)return null;if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("Usa un'immagine JPEG, PNG o WebP.");if(file.size>8*1024*1024)throw new Error("L'immagine originale supera 8 MB.");
  const source=await communityImageSource(file),sourceWidth=source.width||source.naturalWidth,sourceHeight=source.height||source.naturalHeight;
  try{
    for(const [maximum,quality] of [[1440,.82],[1200,.76],[960,.7],[800,.64]]){
      const scale=Math.min(1,maximum/Math.max(sourceWidth,sourceHeight)),width=Math.max(1,Math.round(sourceWidth*scale)),height=Math.max(1,Math.round(sourceHeight*scale)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{alpha:false});context.fillStyle="#ffffff";context.fillRect(0,0,width,height);context.drawImage(source,0,0,width,height);let dataUrl=canvas.toDataURL("image/webp",quality);if(!dataUrl.startsWith("data:image/webp"))dataUrl=canvas.toDataURL("image/jpeg",quality);const encoded=dataUrl.split(",")[1]||"",bytes=Math.floor(encoded.length*3/4);if(bytes<=690000)return{dataUrl,name:file.name.slice(0,80),width,height};
    }
  }finally{source.close?.()}
  throw new Error("Immagine troppo complessa: prova un ritaglio più piccolo.");
}
function communityAttachmentMarkup(attachment,variant="message"){if(!attachment?.dataUrl)return"";return `<a class="community-attachment ${esc(variant)}" href="${esc(attachment.dataUrl)}" target="_blank" rel="noopener noreferrer" title="Apri immagine"><img src="${esc(attachment.dataUrl)}" alt="${esc(attachment.name||"Immagine condivisa")}" loading="lazy"></a>`}
function renderCommunityImagePreview(kind){const attachment=kind==="message"?communityMessageAttachment:communityPostAttachment,box=$(kind==="message"?"communityMessageImagePreview":"communityPostImagePreview");box.classList.toggle("hidden",!attachment);box.innerHTML=attachment?`<img src="${esc(attachment.dataUrl)}" alt="Anteprima ${esc(attachment.name)}"><div><b>${esc(attachment.name)}</b><button type="button">Rimuovi</button></div>`:"";const button=box.querySelector("button");if(button)button.onclick=()=>{if(kind==="message"){communityMessageAttachment=null;$("communityMessageImage").value=""}else{communityPostAttachment=null;$("communityPostImage").value=""}renderCommunityImagePreview(kind)}}
async function selectCommunityImage(kind,input){try{const attachment=await prepareCommunityImage(input.files?.[0]);if(kind==="message")communityMessageAttachment=attachment;else communityPostAttachment=attachment;renderCommunityImagePreview(kind)}catch(error){input.value="";showError(error.message)}}

async function loadCommunity(silent=false){
  try{const viewer=communityIdentity().id;state.community=await api(`/api/community?viewer=${encodeURIComponent(viewer)}`);await syncCommunityProfile(!silent);renderCommunity()}
  catch(error){if(!silent)showError(error.message||"Chat Community non disponibile.")}
}
function startCommunityPolling(){clearInterval(communityPollTimer);loadCommunity();communityPollTimer=setInterval(()=>{if(state.currentPage==="community")loadCommunity(true)},5000)}
function stopCommunityPolling(){clearInterval(communityPollTimer);communityPollTimer=null}
function setCommunityTab(tab){state.communityTab=tab==="board"?"board":"live";document.querySelectorAll("[data-community-tab]").forEach(button=>{const active=button.dataset.communityTab===state.communityTab;button.classList.toggle("active",active);button.setAttribute("aria-selected",String(active))});document.querySelectorAll(".community-panel").forEach(panel=>panel.classList.toggle("active",panel.id===`community-${state.communityTab}`));if(state.communityTab==="board")renderCommunityPosts()}
function renderCommunity(){
  $("communityActive").textContent=`${num(state.community.activeNow)} attivi ora`;
  $("communityPersistence").textContent=state.community.persistence==="temporary"?"Anteprima pubblica · memoria temporanea":"Spazio condiviso · archivio locale server";
  renderCommunityMessages();renderCommunityPosts();renderCommunityFollowing();setCommunityTab(state.communityTab);window.CryptoRadarI18n?.translateDocument();
}
function renderCommunityMessages(){
  const profiles=communityProfiles(),messages=state.community.messages||[],box=$("communityMessages"),nearBottom=box.scrollHeight-box.scrollTop-box.clientHeight<90;
  const viewer=communityIdentity().id;
  box.innerHTML=messages.map(message=>{const profile=profiles.get(message.authorId)||{displayName:"Profilo non disponibile",handle:"utente"},tag={idea:"Idea",question:"Domanda",source:"Fonte",risk:"Rischio"}[message.category]||"Idea",isOwn=message.authorId===viewer,votes=isOwn?`<div class="community-vote-readonly"><span>Mi piace · ${num(message.likeCount)}</span><span>Non mi piace · ${num(message.dislikeCount)}</span></div>`:`<div class="community-inline-actions"><button type="button" class="${message.viewerVote==="like"?"active":""}" data-community-vote-action="message-like" data-community-vote-target="${esc(message.id)}" data-active="${String(message.viewerVote==="like")}">Mi piace · ${num(message.likeCount)}</button><button type="button" class="${message.viewerVote==="dislike"?"active danger":""}" data-community-vote-action="message-dislike" data-community-vote-target="${esc(message.id)}" data-active="${String(message.viewerVote==="dislike")}">Non mi piace · ${num(message.dislikeCount)}</button></div>`;return `<article class="community-message"><div class="community-mini-avatar">${esc(communityInitials(profile.displayName))}</div><div><div class="community-message-meta"><b>${esc(profile.displayName)}</b><span>@${esc(profile.handle)}</span><span class="community-message-tag ${esc(message.category)}">${tag}</span>${message.asset?`<span class="community-message-tag">${esc(message.asset)}</span>`:""}<time datetime="${new Date(num(message.createdAt)*1000).toISOString()}">${communityRelativeTime(message.createdAt)}</time></div>${message.body?`<p>${esc(message.body)}</p>`:""}${communityAttachmentMarkup(message.attachment,"message")}${votes}</div></article>`}).join("")||`<div class="community-empty">La conversazione è ancora vuota. Apri con una domanda verificabile.</div>`;
  bindCommunityVoteButtons(box);
  if(nearBottom||messages.length!==communityMessageRendered)box.scrollTop=box.scrollHeight;communityMessageRendered=messages.length;
}
function communityStars(score){return [1,2,3,4,5].map(value=>`<button type="button" class="${value<=score?"active":""}" data-community-star="${value}" aria-label="${value} stelle" title="${value} stelle">★</button>`).join("")}
function communityFeedbackMarkup(post,profiles,viewer){const entries=(post.feedback||[]).filter(entry=>entry.feedback);if(!entries.length)return`<p class="community-feedback-empty">Nessun feedback testuale.</p>`;return `<div class="community-feedback-list">${entries.map(entry=>{const profile=profiles.get(entry.authorId)||{displayName:"Profilo non disponibile",handle:"utente"},isOwn=entry.authorId===viewer,votes=isOwn?`<div class="community-vote-readonly"><span>Mi piace · ${num(entry.likeCount)}</span><span>Non mi piace · ${num(entry.dislikeCount)}</span></div>`:`<div class="community-inline-actions"><button type="button" class="${entry.viewerVote==="like"?"active":""}" data-community-vote-action="feedback-like" data-community-vote-target="${esc(entry.id)}" data-active="${String(entry.viewerVote==="like")}">Mi piace · ${num(entry.likeCount)}</button><button type="button" class="${entry.viewerVote==="dislike"?"active danger":""}" data-community-vote-action="feedback-dislike" data-community-vote-target="${esc(entry.id)}" data-active="${String(entry.viewerVote==="dislike")}">Non mi piace · ${num(entry.dislikeCount)}</button></div>`;return `<div class="community-feedback"><div><b>${esc(profile.displayName)}</b><span>@${esc(profile.handle)} · ${"★".repeat(num(entry.score))}</span></div><p>${esc(entry.feedback)}</p>${votes}</div>`}).join("")}</div>`}
function communityRatingMarkup(post,profiles,viewer,isOwn){const ownRating=post.viewerRating||{},score=num(ownRating.score),summary=post.ratingCount?`${num(post.ratingAverage).toFixed(1)} / 5 · ${num(post.ratingCount)} voti`:`Nessun voto`;return `<div class="community-rating"><div class="community-rating-head"><div><b>Valutazione della community</b><span>${summary}</span></div><div class="community-rating-average">${post.ratingCount?"★ "+num(post.ratingAverage).toFixed(1):"—"}</div></div>${isOwn?`<p class="community-own-rating-note">Non puoi valutare il tuo contributo.</p>`:`<form class="community-feedback-form" data-community-rating-form="${esc(post.id)}" data-score="${score}"><div class="community-stars" role="radiogroup" aria-label="Voto da 1 a 5">${communityStars(score)}</div><textarea maxlength="600" rows="2" placeholder="Feedback facoltativo: cosa è solido e cosa andrebbe verificato?">${esc(ownRating.feedback||"")}</textarea><button type="submit" class="secondary">Salva voto</button></form>`}${communityFeedbackMarkup(post,profiles,viewer)}</div>`}
function renderCommunityPosts(){
  if(!$("communityPosts"))return;const profiles=communityProfiles(),query=$("communitySearch").value.trim().toLowerCase(),filter=$("communityKindFilter").value,following=new Set(state.community.following||[]),followedStrategies=new Set(state.community.followedStrategies||[]),reacted=new Set(state.community.reactedPosts||[]),viewer=communityIdentity().id;
  let posts=state.community.posts||[];if(filter==="following")posts=posts.filter(post=>following.has(post.authorId)||followedStrategies.has(post.id));else if(filter!=="all")posts=posts.filter(post=>post.kind===filter);if(query)posts=posts.filter(post=>{const profile=profiles.get(post.authorId)||{};return [post.title,post.body,post.asset,post.thesis,profile.displayName,profile.handle].join(" ").toLowerCase().includes(query)});
  $("communityPosts").innerHTML=posts.map(post=>{const profile=profiles.get(post.authorId)||{displayName:"Profilo non disponibile",handle:"utente",experience:"beginner"},isOwn=post.authorId===viewer,isFollowing=following.has(post.authorId),strategyFollowed=followedStrategies.has(post.id),hasReacted=reacted.has(post.id),quality=num(post.quality);return `<article class="community-post"><div class="community-post-top"><div class="community-author"><div class="community-mini-avatar">${esc(communityInitials(profile.displayName))}</div><div><b>${esc(profile.displayName)}</b><span>@${esc(profile.handle)} · ${communityExperience(profile.experience)} · ${communityRelativeTime(post.createdAt)}</span></div></div>${isOwn?"":`<button type="button" class="community-follow-button ${isFollowing?"active":""}" data-community-follow-profile="${esc(post.authorId)}" data-active="${String(isFollowing)}">${isFollowing?"Segui già":"Segui"}</button>`}</div><h3>${esc(post.title)}</h3><div class="community-post-meta"><span>${communityKind(post.kind)}</span>${post.asset?`<span>${esc(post.asset)}</span>`:""}<span>${communityTimeframe(post.timeframe)}</span><span>${communityRisk(post.risk)}</span><span class="${quality===4?"quality-4":"quality-low"}">Metodo ${quality}/4</span></div><p class="community-post-body">${esc(post.body)}</p>${communityAttachmentMarkup(post.attachment,"post")}${post.thesis||post.invalidation?`<div class="community-thesis">${post.thesis?`<div><b>TESI</b><span>${esc(post.thesis)}</span></div>`:""}${post.invalidation?`<div><b>INVALIDAZIONE</b><span>${esc(post.invalidation)}</span></div>`:""}</div>`:""}${post.sourceUrl?`<a class="community-post-source" href="${esc(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">Apri la fonte dichiarata</a>`:""}<div class="community-post-actions"><button type="button" class="${hasReacted?"active":""}" data-community-react="${esc(post.id)}" data-active="${String(hasReacted)}">Utile · ${num(post.reactionCount)}</button>${post.kind==="strategy"?`<button type="button" class="${strategyFollowed?"active":""}" data-community-follow-strategy="${esc(post.id)}" data-active="${String(strategyFollowed)}">${strategyFollowed?"Strategia seguita":"Segui strategia"}</button>`:""}<small>${post.kind==="strategy"?`${num(post.strategyFollowerCount)} persone la monitorano`:"Popolarità ≠ affidabilità"}</small></div>${communityRatingMarkup(post,profiles,viewer,isOwn)}</article>`}).join("")||`<div class="community-empty">Nessun contributo corrisponde a questa vista.</div>`;
  document.querySelectorAll("[data-community-follow-profile]").forEach(button=>button.onclick=()=>communityAction("follow-profile",button.dataset.communityFollowProfile,button.dataset.active!=="true"));document.querySelectorAll("[data-community-follow-strategy]").forEach(button=>button.onclick=()=>communityAction("follow-strategy",button.dataset.communityFollowStrategy,button.dataset.active!=="true"));document.querySelectorAll("[data-community-react]").forEach(button=>button.onclick=()=>communityAction("react",button.dataset.communityReact,button.dataset.active!=="true"));
  document.querySelectorAll("[data-community-star]").forEach(button=>button.onclick=()=>{const form=button.closest("[data-community-rating-form]"),score=num(button.dataset.communityStar);form.dataset.score=String(score);form.querySelectorAll("[data-community-star]").forEach(star=>star.classList.toggle("active",num(star.dataset.communityStar)<=score))});document.querySelectorAll("[data-community-rating-form]").forEach(form=>form.onsubmit=submitCommunityRating);bindCommunityVoteButtons($("communityPosts"));
}
function bindCommunityVoteButtons(root){root.querySelectorAll("[data-community-vote-action]").forEach(button=>button.onclick=()=>communityAction(button.dataset.communityVoteAction,button.dataset.communityVoteTarget,button.dataset.active!=="true"))}
function renderCommunityFollowing(){
  const profiles=communityProfiles(),following=(state.community.following||[]).map(id=>profiles.get(id)).filter(Boolean),postMap=new Map((state.community.posts||[]).map(post=>[post.id,post])),strategies=(state.community.followedStrategies||[]).map(id=>postMap.get(id)).filter(Boolean);$("communityFollowCount").textContent=`${following.length+strategies.length} seguiti`;
  $("communityFollowing").innerHTML=[...following.map(profile=>`<div class="community-follow-row"><div class="community-mini-avatar">${esc(communityInitials(profile.displayName))}</div><div><b>${esc(profile.displayName)}</b><span>@${esc(profile.handle)} · ${num(profile.followerCount)} follower</span></div></div>`),...strategies.map(post=>`<div class="community-follow-row"><div class="community-mini-avatar">ST</div><div><b>${esc(post.asset||"Strategia")}</b><span>${esc(post.title)}</span></div></div>`)].join("")||`<p>Nessun profilo o strategia seguita.</p>`;
}
async function sendCommunityMessage(event){event.preventDefault();if(!await requireCommunityProfile())return;const button=$("sendCommunityMessage");button.disabled=true;try{await api("/api/community/message",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:communityIdentity().id,category:$("communityMessageCategory").value,asset:$("communityMessageAsset").value.trim(),body:$("communityMessageBody").value.trim(),attachment:communityMessageAttachment})});$("communityMessageBody").value="";$("communityMessageAsset").value="";$("communityMessageImage").value="";communityMessageAttachment=null;renderCommunityImagePreview("message");updateCommunityMessageCount();await loadCommunity()}catch(error){showError(error.message)}finally{button.disabled=false}}
async function publishCommunityPost(event){event.preventDefault();if(!await requireCommunityProfile())return;const button=event.submitter;button.disabled=true;try{await api("/api/community/post",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:communityIdentity().id,kind:$("communityPostKind").value,asset:$("communityPostAsset").value.trim(),timeframe:$("communityPostTimeframe").value,risk:$("communityPostRisk").value,title:$("communityPostTitle").value.trim(),body:$("communityPostBody").value.trim(),thesis:$("communityPostThesis").value.trim(),invalidation:$("communityPostInvalidation").value.trim(),sourceUrl:$("communityPostSource").value.trim(),attachment:communityPostAttachment})});event.currentTarget.reset();communityPostAttachment=null;renderCommunityImagePreview("post");updateCommunityQualityHint();$("communityComposer").open=false;await loadCommunity()}catch(error){showError(error.message)}finally{button.disabled=false}}
async function submitCommunityRating(event){event.preventDefault();if(!await requireCommunityProfile())return;const form=event.currentTarget,score=num(form.dataset.score),button=form.querySelector("button[type='submit']");if(score<1||score>5)return showError("Seleziona un voto da 1 a 5 stelle.");button.disabled=true;try{await api("/api/community/rating",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:communityIdentity().id,postId:form.dataset.communityRatingForm,score,feedback:form.querySelector("textarea").value.trim()})});await loadCommunity(true)}catch(error){showError(error.message)}finally{button.disabled=false}}
async function communityAction(action,targetId,active){if(!await requireCommunityProfile())return;try{await api("/api/community/action",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({userId:communityIdentity().id,action,targetId,active})});await loadCommunity(true)}catch(error){showError(error.message)}}
function updateCommunityQualityHint(){const score=["communityPostThesis","communityPostInvalidation","communityPostSource"].filter(id=>$(id).value.trim()).length+($("communityPostRisk").value!=="not-assessed"?1:0),strategy=$("communityPostKind").value==="strategy";$("communityQualityHint").textContent=`Completezza metodologica: ${score}/4${strategy&&score<4?" · per una strategia rendi espliciti tesi, invalidazione, rischio e fonte.":" · misura la struttura, non la qualità dell'investimento."}`}
function updateCommunityMessageCount(){$("communityMessageCount").textContent=$("communityMessageBody").value.length}

function showPage(id,title){state.currentPage=id;revealSidebarTarget(id);document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.target===id));applySidebarLayout(false);$("pageTitle").textContent=title||({purpose:'A cosa serve',overview:'Panoramica',screener:'Potenziali Crypto',portfolio:'Il mio portafoglio',connections:'Exchange & wallet',academy:'Guide & Manuali',plan:'Piano personale',copilot:'Assistente Personale',decision:'Laboratorio',operations:'Centro operativo',advanced:'Strumenti avanzati',intelligence:'Intelligence Hub',community:'Chat Community',news:'News & trend',tax:'730 & fiscalità crypto',method:'Metodo & rischio'}[id]||'Analisi');if(id==="advanced")renderAdvanced();if(id==="intelligence")renderIntelligence();renderTutor();window.CryptoRadarI18n?.translateDocument();window.scrollTo({top:0,behavior:'smooth'})}
const showPageCore=showPage;
showPage=function(id,title){showPageCore(id,title||(id==="community"?"Chat Community":undefined));if(id==="community")startCommunityPolling();else stopCommunityPolling()};
const sectionGuideLinks={overview:"app-start",screener:"app-start",portfolio:"portfolio-manual",connections:"portfolio-manual",academy:"academy-manual",plan:"plan-manual",copilot:"copilot-manual",decision:"decision-manual",operations:"operations-manual",advanced:"advanced-manual",intelligence:"intelligence-manual",community:"community-manual",news:"news-manual",tax:"tax-method-manual",method:"tax-method-manual",detail:"research"};
function openGuide(lessonId){
  if(!lessonId)return;
  showPage("academy");
  window.setTimeout(()=>{
    const lesson=document.querySelector(`[data-lesson="${lessonId}"]`);
    if(!lesson)return;
    lesson.open=true;
    lesson.scrollIntoView({behavior:"auto",block:"start"});
    lesson.querySelector("summary")?.focus({preventScroll:true});
  },120);
}
function installSectionHelpLinks(){
  Object.entries(sectionGuideLinks).forEach(([pageId,lessonId])=>{
    const section=$(pageId);
    if(!section||section.dataset.sectionHelpInstalled)return;
    section.dataset.sectionHelpInstalled="true";
    const bar=document.createElement("div");
    bar.className="section-help-bar";
    bar.innerHTML='<div class="section-help-copy"><b>Guida della sezione</b><span>Spiegazione dei campi, procedura consigliata e limiti dello strumento.</span></div><button type="button" class="secondary">Come funziona</button>';
    bar.querySelector("button").onclick=()=>openGuide(lessonId);
    section.prepend(bar);
  });
}
installSectionHelpLinks();
const glossary=[
  ["Altcoin","Qualsiasi crypto diversa da Bitcoin; non indica automaticamente qualità o rischio."],["ATH","All-time high: prezzo massimo storico registrato."],["Blockchain","Registro condiviso in cui le transazioni vengono validate secondo le regole del protocollo."],["Circulating supply","Numero di token attualmente in circolazione."],["DCA","Acquisti di importo uguale effettuati a intervalli regolari."],["Drawdown","Perdita percentuale da un massimo a un minimo successivo."],["FDV","Valutazione teorica ottenuta usando l'offerta totale o massima, se disponibile."],["Gas fee","Commissione pagata per eseguire una transazione su una blockchain."],["Market cap","Prezzo corrente moltiplicato per l'offerta circolante."],["Seed phrase","Sequenza segreta che consente di recuperare un wallet; non va mai condivisa."],["Slippage","Differenza tra prezzo atteso e prezzo effettivo di esecuzione."],["Spread","Differenza tra miglior prezzo di acquisto e di vendita."],["Stablecoin","Token che mira a mantenere un valore stabile; non è privo di rischio."],["Staking","Impiego di token nella sicurezza o nel funzionamento di una rete in cambio di ricompense."],["TVL","Valore totale degli asset depositati in un protocollo, usato soprattutto nella DeFi."],["Volatilità","Ampiezza e frequenza delle variazioni di prezzo."],["Volume","Valore scambiato in un periodo; va interpretato insieme a liquidità e affidabilità del mercato."],["White paper","Documento che descrive progetto, funzionamento, rischi e caratteristiche del token."]
];
glossary.push(
  ["Consenso","Regole con cui i partecipanti di una rete concordano sullo stato valido del registro."],
  ["Fungibile","Intercambiabile uno-a-uno con un'altra unità della stessa tipologia."],
  ["NFT","Token non fungibile identificabile singolarmente e con proprietà potenzialmente uniche."],
  ["Nodo","Computer che conserva o verifica dati e regole di una rete blockchain."],
  ["Smart contract","Programma eseguito dalla blockchain quando vengono soddisfatte le condizioni previste."]
  ,["Cold wallet","Sistema di custodia in cui le chiavi sono mantenute offline o in un dispositivo dedicato."]
  ,["Hot wallet","Wallet software su dispositivo connesso a internet, comodo ma più esposto agli attacchi."]
  ,["Chiave privata","Segreto crittografico che autorizza le operazioni; non deve essere condiviso."]
  ,["Indirizzo","Identificativo pubblico usato per ricevere asset su una specifica rete."]
  ,["Hash transazione","Identificativo con cui cercare e documentare una transazione sulla blockchain."]
  ,["Ribilanciamento","Operazioni con cui si riporta il portafoglio verso l’allocazione obiettivo."]
);
function loadAcademyState(){try{return JSON.parse(localStorage.getItem("cryptoRadarAcademy")||"{}")||{}}catch{return {}}}
function saveAcademyState(data){localStorage.setItem("cryptoRadarAcademy",JSON.stringify(data))}
function renderAcademy(){
  const saved=loadAcademyState(),lessons=[...document.querySelectorAll('[data-complete]')],checks=[...document.querySelectorAll('[data-check]')];
  lessons.forEach(input=>input.checked=Boolean(saved.lessons?.[input.dataset.complete]));checks.forEach(input=>input.checked=Boolean(saved.checks?.[input.dataset.check]));
  const completed=lessons.filter(x=>x.checked).length,pct=lessons.length?Math.round(completed/lessons.length*100):0;
  $("academyProgress").textContent=`${pct}%`;$("academyProgressBar").style.width=`${pct}%`;
  const checked=checks.filter(x=>x.checked).length;$("academyCheckResult").textContent=checked===checks.length?"Checklist completa · ora rileggi la tesi":`${checked}/${checks.length} controlli`;$("academyCheckResult").classList.toggle("complete",checked===checks.length);
}
function persistAcademy(){const lessons={},checks={};document.querySelectorAll('[data-complete]').forEach(x=>lessons[x.dataset.complete]=x.checked);document.querySelectorAll('[data-check]').forEach(x=>checks[x.dataset.check]=x.checked);saveAcademyState({lessons,checks});renderAcademy()}
function renderGlossary(query=""){const needle=query.trim().toLowerCase(),rows=glossary.filter(([term,text])=>`${term} ${text}`.toLowerCase().includes(needle));$("glossaryList").innerHTML=rows.map(([term,text])=>`<div class="glossary-item"><b>${esc(term)}</b><span>${esc(text)}</span></div>`).join("")||`<p class="muted">Nessun termine trovato.</p>`}
document.querySelectorAll('[data-complete],[data-check]').forEach(input=>input.onchange=persistAcademy);
$("glossarySearch").oninput=event=>renderGlossary(event.target.value);
renderGlossary();renderAcademy();
document.querySelectorAll('[data-guide-open]').forEach(button=>button.onclick=()=>openGuide(button.dataset.guideOpen));
document.querySelectorAll('[data-help-guide]').forEach(button=>button.onclick=()=>openGuide(button.dataset.helpGuide));
function renderTaxChecklist(){const checks=[...document.querySelectorAll('[data-tax-check]')],saved=localData("cryptoRadarTaxChecklist",{});checks.forEach((check,index)=>check.checked=Boolean(saved[index]));const done=checks.filter(check=>check.checked).length,pct=checks.length?Math.round(done/checks.length*100):0;if($("taxCheckLabel"))$("taxCheckLabel").textContent=`${done}/${checks.length} documenti controllati`;if($("taxCheckBar"))$("taxCheckBar").style.width=`${pct}%`}
document.querySelectorAll('[data-tax-check]').forEach((check,index)=>check.onchange=()=>{const saved=localData("cryptoRadarTaxChecklist",{});saved[index]=check.checked;saveLocalData("cryptoRadarTaxChecklist",saved);renderTaxChecklist()});
renderTaxChecklist();
function renderFirstTaxPath(){
  const checks=[...document.querySelectorAll("[data-tax-first]")],saved=localData("cryptoRadarFirstDeclaration2026",{});
  checks.forEach(check=>check.checked=Boolean(saved[check.dataset.taxFirst]));
  const done=checks.filter(check=>check.checked).length,pct=checks.length?Math.round(done/checks.length*100):0;
  if($("taxFirstProgressLabel"))$("taxFirstProgressLabel").textContent=done===checks.length?"Percorso preparatorio completato":`${done}/${checks.length} passaggi completati`;
  if($("taxFirstProgressBar"))$("taxFirstProgressBar").style.width=`${pct}%`;
}
document.querySelectorAll("[data-tax-first]").forEach(check=>check.onchange=()=>{
  const saved=localData("cryptoRadarFirstDeclaration2026",{});
  saved[check.dataset.taxFirst]=check.checked;
  saveLocalData("cryptoRadarFirstDeclaration2026",saved);
  renderFirstTaxPath();
});
if($("resetTaxFirstPath"))$("resetTaxFirstPath").onclick=()=>{
  localStorage.removeItem("cryptoRadarFirstDeclaration2026");
  renderFirstTaxPath();
};
document.querySelectorAll("[data-tax-open]").forEach(button=>button.onclick=()=>{
  const lesson=$(button.dataset.taxOpen);
  if(!lesson)return;
  lesson.open=true;
  lesson.scrollIntoView({behavior:"smooth",block:"start"});
});
renderFirstTaxPath();
const taxTemplateFiles={
  inventory:{
    filename:"crypto-radar-inventario-crypto-2025.csv",
    type:"text/csv;charset=utf-8",
    content:()=>"\ufeffPiattaforma_o_wallet;Tipo_custodia;Paese_o_sede;Asset;Rete;Indirizzo_wallet;Quantita_iniziale_01_01_2025;Valore_iniziale_EUR;Data_primo_possesso_2025;Quantita_finale_31_12_2025;Valore_finale_EUR;Data_cessione_se_anteriore;Giorni_possesso;Bollo_o_imposta_applicata;Documento_fonte;Note\r\n"
  },
  transactions:{
    filename:"crypto-radar-registro-operazioni-fiscali-2025.csv",
    type:"text/csv;charset=utf-8",
    content:()=>"\ufeffData_ora;Fuso_orario;Piattaforma;Wallet;Tipo_evento;Asset_ceduto;Quantita_ceduta;Asset_ricevuto;Quantita_ricevuta;Corrispettivo_o_valore_EUR;Costo_documentato_EUR;Commissioni_EUR;Fonte_cambio;Hash_o_ID;Wallet_proprio_SI_NO;Classificazione_da_verificare;Documento_fonte;Note\r\n"
  },
  reconciliation:{
    filename:"crypto-radar-riconciliazione-trasferimenti-2025.csv",
    type:"text/csv;charset=utf-8",
    content:()=>"\ufeffID_abbinamento;Data_ora_uscita;Piattaforma_wallet_uscita;Asset;Quantita_uscita;Fee_asset;Fee_quantita;Hash_o_ID_uscita;Data_ora_ingresso;Piattaforma_wallet_ingresso;Quantita_ingresso;Hash_o_ID_ingresso;Entrambi_wallet_propri_SI_NO;Differenza_spiegata;Prova_titolarita;Esito_riconciliazione;Note\r\n"
  },
  handover:{
    filename:"crypto-radar-checklist-consegna-730-2026.txt",
    type:"text/plain;charset=utf-8",
    content:()=>`CRYPTO RADAR - CHECKLIST CONSEGNA FISCALE
Anno dichiarazione: 2026
Periodo d'imposta: 2025
Documento preparatorio non ufficiale

1. DATI GENERALI
[ ] Documento di identità e codice fiscale
[ ] CU 2026 e altri redditi 2025
[ ] Dichiarazione, ricevuta e F24 dell'anno precedente
[ ] Elenco di acconti, crediti e comunicazioni ricevute

2. INVENTARIO CRYPTO
[ ] Tutti gli exchange inclusi
[ ] Tutti i wallet e indirizzi inclusi
[ ] Saldi iniziali e finali riconciliati
[ ] Periodi di possesso e valori in euro documentati
[ ] Bollo o imposta applicati dai provider verificati

3. OPERAZIONI
[ ] CSV originali conservati senza modifiche
[ ] Vendite, swap, pagamenti e commissioni registrati
[ ] Trasferimenti fra wallet propri abbinati
[ ] Staking, lending, airdrop, DeFi, NFT e mining separati
[ ] Costi di acquisto e fonti cambio documentati
[ ] Operazioni dubbie evidenziate, senza forzare una classificazione

4. DOMANDE AL PROFESSIONISTA
[ ] Il 730 è sufficiente o serve Redditi PF?
[ ] Quali righe di W/RW e T/RT sono state compilate?
[ ] Come sono stati trattati permute, fee e proventi?
[ ] Come sono state gestite imposta sul valore, bollo e duplicazioni?
[ ] Quali minusvalenze restano riportabili e fino a quando?
[ ] Quali F24 devo pagare personalmente, con quali scadenze?
[ ] Serve una correzione o un ravvedimento per anni precedenti?

5. DOCUMENTI DA RICEVERE
[ ] Copia completa della dichiarazione inviata
[ ] Prospetto 730-3 o prospetto di liquidazione Redditi
[ ] Ricevuta telematica
[ ] F24 predisposti e relative scadenze
[ ] Quietanze dopo il pagamento
[ ] Prospetto dei calcoli crypto e delle fonti utilizzate

FONTI UFFICIALI
Istruzioni 730/2026:
https://infoprecompilata.agenziaentrate.gov.it/portale/documents/d/guest/730_istruzioni_2026.pdf
Quadro W:
https://infoprecompilata.agenziaentrate.gov.it/portale/quadro-w
Quadro T:
https://infoprecompilata.agenziaentrate.gov.it/portale/quadro-t
Redditi PF 2026 - Fascicolo 2:
https://infoprecompilata.agenziaentrate.gov.it/portale/documents/d/guest/pf2_istruzioni_2026.pdf

Nota: questo file organizza la consegna. Non certifica calcoli, classificazioni o imposte.`
  }
};
document.querySelectorAll('[data-tax-template]').forEach(button=>button.onclick=()=>{
  const template=taxTemplateFiles[button.dataset.taxTemplate];
  if(!template)return;
  downloadBlob(template.filename,template.content(),template.type);
  const original=button.textContent;
  button.textContent="File scaricato ✓";
  setTimeout(()=>button.textContent=original,1400);
});
let selectedExchange="";
let importPreviewToken="";
document.querySelectorAll('.inspect-csv').forEach(button=>button.onclick=()=>{selectedExchange=button.dataset.exchange;$("exchangeCsv").value="";$("exchangeCsv").click()});
$("exchangeCsv").onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>2.5*1024*1024){showError("Il CSV supera il limite di 2,5 MB.");return}
  const label={coinbase:"Coinbase",kraken:"Kraken",bitvavo:"Bitvavo"}[selectedExchange]||"Exchange";
  try{
    $("csvInspectorTitle").textContent=`${label} · analisi in corso…`;$("csvInspectorText").textContent="Riconoscimento delle operazioni e controllo dei duplicati.";$("csvInspectorResult").innerHTML=`<p class="muted">Lettura del file…</p>`;
    const text=await file.text();
    const result=await api("/api/import/preview",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({exchange:selectedExchange,filename:file.name,csv:text})});
    importPreviewToken=result.token;
    $("csvInspectorTitle").textContent=`${label} · ${file.name}`;
    $("csvInspectorText").textContent="Anteprima pronta: verifica le operazioni prima di confermare.";
    const previewRows=(result.preview||[]).map(t=>`<tr><td>${esc(t.timestamp)}</td><td>${esc(t.type)}</td><td>${esc(t.asset)}</td><td>${t.amount??"—"}</td><td>${esc(t.quoteAsset||"")}</td><td>${t.feeAmount??"—"}</td></tr>`).join("");
    const errors=(result.errors||[]).map(x=>`<div class="import-warning">${esc(x)}</div>`).join("");
    $("csvInspectorResult").innerHTML=`<div class="csv-result-grid"><div><span>RICONOSCIUTE</span><b>${result.recognized}</b></div><div><span>DA CONTROLLARE</span><b>${result.skipped}</b></div></div><div class="table-wrap import-preview-table"><table><thead><tr><th>Data</th><th>Tipo</th><th>Asset</th><th>Quantità</th><th>Valuta</th><th>Fee</th></tr></thead><tbody>${previewRows}</tbody></table></div>${errors}<button id="confirmCsvImport" class="primary import-confirm">Conferma e salva ${result.recognized} operazioni</button>`;
    $("confirmCsvImport").onclick=confirmCsvImport;
  }catch(error){showError(error.message||"Impossibile leggere il CSV.")}
};
async function confirmCsvImport(){
  if(!importPreviewToken)return;const button=$("confirmCsvImport");button.disabled=true;button.textContent="Salvataggio…";
  try{const result=await api("/api/import/confirm",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:importPreviewToken})});importPreviewToken="";$("csvInspectorText").textContent=`Importazione completata: ${result.imported} salvate, ${result.duplicates} duplicate ignorate.`;$("csvInspectorResult").innerHTML=`<div class="risk-item rule-ok">Registro aggiornato con ${result.imported} nuove operazioni.</div>`;await loadImportHistory()}catch(error){showError(error.message);button.disabled=false;button.textContent="Riprova importazione"}
}
async function loadImportHistory(){
  try{const data=await api("/api/transactions");state.transactions=data.transactions||[];state.transactionTotal=num(data.total);$("transactionTotal").textContent=`${data.total} transazioni`;$("importHistory").innerHTML=(data.batches||[]).map(batch=>`<div class="import-batch"><div><b>${esc(batch.exchange?.toUpperCase()||"EXCHANGE")}</b><span>${esc(batch.filename||"CSV")} · ${batch.count} operazioni · ${new Date(batch.importedAt*1000).toLocaleString("it-IT")}</span></div><button class="journal-delete undo-import" data-batch-id="${esc(batch.batchId)}">Annulla</button></div>`).join("")||`<p class="muted">Nessuna importazione salvata.</p>`;document.querySelectorAll('.undo-import').forEach(button=>button.onclick=()=>undoImport(button.dataset.batchId));renderTaxIntegrity();renderBrief()}catch(error){/* La pagina principale resta utilizzabile. */}
}
async function undoImport(batchId){if(!confirm("Annullare questa importazione e rimuovere tutte le sue operazioni?"))return;try{await api(`/api/import?batchId=${encodeURIComponent(batchId)}`,{method:"DELETE"});await loadImportHistory()}catch(error){showError(error.message)}}
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>showPage(n.dataset.target));
document.querySelectorAll("[data-chart-range]").forEach(button=>button.onclick=()=>loadDetailHistory(button.dataset.chartRange));
document.querySelectorAll("[data-chart-type]").forEach(button=>button.onclick=()=>setDetailChartType(button.dataset.chartType));
syncDetailChartType();
document.querySelectorAll("[data-sidebar-group-toggle]").forEach(button=>button.onclick=()=>toggleSidebarGroup(button.dataset.sidebarGroupToggle));
document.querySelectorAll('[data-go]').forEach(n=>n.onclick=()=>showPage(n.dataset.go));
document.querySelectorAll('[data-community-tab]').forEach(button=>button.onclick=()=>setCommunityTab(button.dataset.communityTab));
$("communityMessageForm").onsubmit=sendCommunityMessage;$("communityPostForm").onsubmit=publishCommunityPost;$("communitySearch").oninput=renderCommunityPosts;$("communityKindFilter").onchange=renderCommunityPosts;$("communityMessageBody").oninput=updateCommunityMessageCount;$("communityMessageImage").onchange=event=>selectCommunityImage("message",event.target);$("communityPostImage").onchange=event=>selectCommunityImage("post",event.target);$("refreshCommunity").onclick=()=>loadCommunity();["communityPostKind","communityPostRisk","communityPostThesis","communityPostInvalidation","communityPostSource"].forEach(id=>$(id).addEventListener("input",updateCommunityQualityHint));
document.querySelectorAll('[data-home-language]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-home-language]').forEach(item=>item.classList.toggle('active',item===button));window.CryptoRadarI18n?.setLanguage(button.dataset.homeLanguage)});
document.querySelectorAll('[data-ops-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-ops-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.ops-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`ops-${button.dataset.opsTab}`));if(button.dataset.opsTab==="report")renderWeeklyReport();if(button.dataset.opsTab==="paper")renderPaper();if(button.dataset.opsTab==="calendar")renderCalendar()});
document.querySelectorAll('[data-copilot-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-copilot-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.copilot-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`copilot-${button.dataset.copilotTab}`));if(button.dataset.copilotTab==="passports")renderPassports();if(button.dataset.copilotTab==="monthly")renderMonthlyBehavior();if(button.dataset.copilotTab==="fiscal")renderFiscalReadiness();if(button.dataset.copilotTab==="scores")renderScoreChanges();if(button.dataset.copilotTab==="quality")renderDataQuality();if(button.dataset.copilotTab==="privacy")renderPrivacy()});
document.querySelectorAll('[data-advanced-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-advanced-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.advanced-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`advanced-${button.dataset.advancedTab}`));if(button.dataset.advancedTab==="risk")renderAdvancedRisk();if(button.dataset.advancedTab==="mica")loadMicaRegistryStats();window.CryptoRadarI18n?.translateDocument()});
document.querySelectorAll('[data-intelligence-tab]').forEach(button=>button.onclick=()=>{state.intelligenceTab=button.dataset.intelligenceTab;document.querySelectorAll('[data-intelligence-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.intelligence-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`intelligence-${button.dataset.intelligenceTab}`));renderIntelligence();window.CryptoRadarI18n?.translateDocument()});
document.querySelectorAll('#newsFilters .chip').forEach(button=>button.onclick=()=>{state.newsFilter=button.dataset.filter;document.querySelectorAll('#newsFilters .chip').forEach(x=>x.classList.toggle('active',x===button));renderNews()});
document.querySelectorAll("[data-stress]").forEach(button=>button.onclick=()=>setStressPreset(button.dataset.stress));
document.querySelectorAll("[data-intel-stress]").forEach(button=>button.onclick=()=>setIntelStress(button.dataset.intelStress));
setupCatalogPickers();
ensureRestoreLocalControl();
$("refreshBtn").onclick=()=>loadAll(true);$("applyFilters").onclick=renderScreener;$("savePortfolio").onclick=savePortfolio;$("addPortfolioCoin").onclick=addPortfolioCoin;$("savePlan").onclick=savePlan;$("runDca").onclick=runDca;$("analyzeTrade").onclick=analyzeTrade;$("saveDecision").onclick=saveDecision;$("backBtn").onclick=()=>showPage('overview');
$("openHomeLayout").onclick=()=>toggleHomeLayout($("homeLayoutManager").classList.contains("hidden"));$("closeHomeLayout").onclick=()=>toggleHomeLayout(false);$("resetHomeLayout").onclick=resetHomeLayout;
$("openSidebarLayout").onclick=()=>toggleSidebarLayout($("sidebarLayoutManager").classList.contains("hidden"));$("closeSidebarLayout").onclick=()=>toggleSidebarLayout(false);$("sidebarLayoutBackdrop").onclick=()=>toggleSidebarLayout(false);$("resetSidebarLayout").onclick=resetSidebarLayout;$("openSidebarProfile").onclick=()=>{toggleSidebarLayout(false);openOnboarding()};document.querySelectorAll("[data-sidebar-density]").forEach(button=>button.onclick=()=>setSidebarDensity(button.dataset.sidebarDensity));document.querySelectorAll("[data-sidebar-interface]").forEach(button=>button.onclick=()=>setSidebarInterface(button.dataset.sidebarInterface));document.querySelectorAll("[data-sidebar-preset]").forEach(button=>button.onclick=()=>setSidebarPreset(button.dataset.sidebarPreset));document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("sidebarLayoutManager").classList.contains("hidden"))toggleSidebarLayout(false)});
$("managePinned").onclick=()=>{$("pinnedManager").classList.toggle("hidden");if(!$("pinnedManager").classList.contains("hidden")){$("pinnedCoinSearch").focus();renderPinnedOptions(true)}else closePinnedOptions()};$("closePinned").onclick=()=>{$("pinnedManager").classList.add("hidden");closePinnedOptions()};$("addPinned").onclick=addPinnedCoin;
$("pinnedCoinSearch").onfocus=()=>state.marketCatalogLoaded?renderPinnedOptions(true):loadMarketCatalog($("pinnedCoinSearch").value,true);
$("pinnedCoinSearch").oninput=()=>{$("pinnedCoinSelect").value="";$("addPinned").disabled=true;state.marketCatalogLoading=true;renderPinnedOptions(true);queuePinnedCatalogSearch(true)};
$("pinnedCoinSearch").onkeydown=event=>{if(event.key==="ArrowDown"){event.preventDefault();movePinnedOption(1)}else if(event.key==="ArrowUp"){event.preventDefault();movePinnedOption(-1)}else if(event.key==="Escape"){closePinnedOptions()}else if(event.key==="Enter"){event.preventDefault();const active=document.querySelector("[data-pinned-option].active"),first=document.querySelector("[data-pinned-option]");if(!$("pinnedCoinSelect").value&&(active||first))choosePinnedOption((active||first).dataset.pinnedOption);else addPinnedCoin()}};
$("pinnedCoinSort").onchange=()=>{localStorage.setItem("cryptoRadarPinnedSort",$("pinnedCoinSort").value);$("pinnedCoinSelect").value="";$("addPinned").disabled=true;loadMarketCatalog($("pinnedCoinSearch").value,true);$("pinnedCoinSearch").focus()};
document.addEventListener("click",event=>{if(!event.target.closest(".pinned-picker")&&!event.target.closest("#managePinned")&&!event.target.closest("[data-open-pinned]"))closePinnedOptions()});
$("runCopilot").onclick=runCopilotWithCooldown;$("savePassport").onclick=savePassport;$("exportMonthlyReport").onclick=exportMonthlyBehavior;$("saveFiscalReadiness").onclick=saveFiscalReadiness;$("saveScoreSnapshot").onclick=saveScoreSnapshot;$("refreshQuality").onclick=renderDataQuality;$("dataQualityBadge").onclick=()=>openCopilotTab("quality");$("runSecurityRadar").onclick=runSecurityRadar;$("saveLocalProfile").onclick=saveLocalProfile;$("generateShareReport").onclick=generateShareReport;$("exportAllLocal").onclick=downloadAllLocal;$("downloadLocalData").onclick=downloadAllLocal;$("exportPassports").onclick=()=>downloadBlob(`crypto-radar-passaporti-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(localData(copilotStore.passports,[]),null,2));$("deleteLocalData").onclick=()=>{if(!confirm("Eliminare tutti i dati locali di Crypto Radar da questo browser? L’operazione non può essere annullata senza un backup."))return;[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).filter(k=>k?.startsWith("cryptoRadar")).forEach(k=>localStorage.removeItem(k));location.reload()};$("tutorToggle").onclick=()=>toggleTutor(!$("tutorDrawer").classList.contains("open"));$("tutorClose").onclick=()=>toggleTutor(false);
$("portfolioCoinSelect").onchange=updatePortfolioPickerState;$("saveAlertSettings").onclick=saveAlertSettings;$("saveWeeklySnapshot").onclick=saveWeeklySnapshot;$("printWeeklyReport").onclick=()=>window.print();$("paperCoin").onchange=updatePaperPreview;$("paperAmount").oninput=updatePaperPreview;$("paperFee").oninput=updatePaperPreview;$("paperAction").onchange=updatePaperPreview;$("executePaper").onclick=executePaper;$("resetPaper").onclick=resetPaper;$("addCalendarEvent").onclick=addCalendarEvent;$("saveCalendarRoutines").onclick=saveCalendarRoutines;$("exportCalendar").onclick=exportCalendar;
$("openOnboarding").onclick=openOnboarding;$("closeOnboarding").onclick=closeOnboarding;$("onboardingBack").onclick=()=>setOnboardingStep(onboardingStep-1);$("onboardingNext").onclick=nextOnboarding;$("interfaceMode").onclick=()=>applyInterfaceMode(interfaceMode()==="beginner"?"advanced":"beginner");document.querySelectorAll("[data-cooldown-hours]").forEach(button=>button.onclick=()=>startCooldown(num(button.dataset.cooldownHours)));
$("runExecution").onclick=runExecutionLab;$("refreshRiskEngine").onclick=renderAdvancedRisk;$("runMicaSearch").onclick=runMicaSearch;$("micaQuery").onkeydown=event=>{if(event.key==="Enter")runMicaSearch()};
$("refreshIntelligence").onclick=()=>loadMarketIntelligence(true);$("addIntelEvent").onclick=addIntelligenceEvent;$("runIntelStress").onclick=renderIntelStress;$("runTaxIntegrity").onclick=()=>{renderTaxIntegrity();renderBrief()};$("regenerateIntelBrief").onclick=renderBrief;$("copyIntelBrief").onclick=async()=>{try{await navigator.clipboard.writeText(briefText());$("copyIntelBrief").textContent="Copiato ✓";setTimeout(()=>$("copyIntelBrief").textContent="Copia testo",1400)}catch{showError("Il browser non consente la copia automatica.")}};$("downloadIntelBrief").onclick=()=>downloadBlob(`crypto-radar-brief-${localIsoDate(new Date())}.txt`,briefText(),"text/plain;charset=utf-8");if(!$("intelEventDate").value){const next=new Date();next.setDate(next.getDate()+7);$("intelEventDate").value=localIsoDate(next)}
document.addEventListener("crypto-radar-language",()=>{state.translations={};if(state.scored.length){renderOverview();renderScreener();renderPortfolio();renderPlan();renderDecisionLab();renderOperations();renderCopilot();renderAdvanced();renderIntelligence();renderTutor();renderNews()}renderSidebarLayoutManager();loadTranslations()});
setupPwa();
applySidebarLayout();
loadAll();
