const state = { markets: [], scored: [], portfolio: null, plan: null, journal: [], trending: [], news: [], translations: {}, newsFilter: "ALL", currentPage: "overview", demo: false };
const $ = (id) => document.getElementById(id);
const clamp = (x, lo=0, hi=100) => Math.min(hi, Math.max(lo, x));
const fmtEur = (n, compact=false) => new Intl.NumberFormat("it-IT", {style:"currency",currency:"EUR",notation:compact?"compact":"standard",maximumFractionDigits:n<1?5:2}).format(n||0);
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
    const [marketResponse,portfolio,plan,journalResponse,trendResponse,newsResponse,config]=await Promise.all([
      api("/api/markets"), api("/api/portfolio"), api("/api/plan"), api("/api/journal").catch(()=>({entries:[]})),
      api("/api/trending").catch(()=>({coins:[]})),
      api("/api/news").catch(()=>({articles:[]})), api("/api/config").catch(()=>({demo:false}))
    ]);
    state.markets=marketResponse.data;
    state.scored=state.markets.map(scoreCoin).sort((a,b)=>b._score-a._score);
    state.portfolio=portfolio;
    state.plan=plan;
    state.journal=journalResponse.entries||[];
    state.trending=(trendResponse.coins||[]).map(x=>x.item).slice(0,10);
    state.news=newsResponse.articles||[];
    state.demo=Boolean(config.demo);
    $("lastUpdate").textContent=`Aggiornato ${new Date(marketResponse.asOf*1000).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}`;
    renderOverview(); renderScreener(); renderPortfolio(); renderPlan(); renderDecisionLab(); renderDiscovery(); renderDemoMode(); loadImportHistory(); renderOperations(); renderCopilot();
    loadTranslations();
  }catch(error){ showError(error.message); }
  finally{$("refreshBtn").classList.remove("flash")}
}

function renderDemoMode(){
  $("demoBanner").classList.toggle("hidden",!state.demo);
  ["savePortfolio","savePlan","saveDecision"].forEach(id=>{const button=$(id);if(!button)return;button.disabled=state.demo;if(state.demo)button.title="Disabilitato nella demo pubblica"});
}

function showError(message){$("notice").textContent=message;$("notice").classList.remove("hidden")}
function coinById(id){return state.scored.find(c=>c.id===id)}
function pinnedIds(){
  try{const value=JSON.parse(localStorage.getItem("cryptoRadarPinnedCoins")||"[]");return Array.isArray(value)?[...new Set(value.filter(id=>typeof id==="string"))].slice(0,5):[]}
  catch{return []}
}
function savePinnedIds(ids){localStorage.setItem("cryptoRadarPinnedCoins",JSON.stringify([...new Set(ids)].slice(0,5)))}
function renderPinnedManager(){
  const ids=pinnedIds().filter(id=>coinById(id)),coins=ids.map(coinById).filter(Boolean),available=state.scored.filter(c=>!ids.includes(c.id));
  if(ids.length!==pinnedIds().length)savePinnedIds(ids);
  $("pinnedCount").textContent=`${ids.length}/5 selezionate`;
  $("pinnedTitle").textContent=ids.length?"Le tue crypto":"Scegli le crypto da seguire";
  $("pinnedCoinSelect").innerHTML=available.length?`<option value="">Seleziona per nome o simbolo…</option>${available.map(c=>`<option value="${esc(c.id)}">#${c.market_cap_rank||"—"} · ${esc(c.name)} (${esc(c.symbol.toUpperCase())})</option>`).join("")}`:`<option value="">Nessuna crypto disponibile</option>`;
  $("pinnedSelection").innerHTML=coins.length?coins.map(c=>`<span class="pinned-chip"><img src="${esc(c.image)}" alt=""><b>${esc(c.symbol.toUpperCase())}</b><button type="button" data-unpin="${esc(c.id)}" aria-label="Rimuovi ${esc(c.name)}">×</button></span>`).join(""):`<p class="muted">Non hai ancora fissato crypto. Scegline una dal menu.</p>`;
  $("addPinned").disabled=true;
  $("pinnedMessage").textContent=ids.length>=5?"Hai raggiunto il massimo di 5 crypto.":"Le schede non modificano il tuo portafoglio.";
  document.querySelectorAll("[data-unpin]").forEach(button=>button.onclick=()=>{savePinnedIds(ids.filter(id=>id!==button.dataset.unpin));renderOverview()});
}
function addPinnedCoin(){const id=$("pinnedCoinSelect").value,ids=pinnedIds();if(!id||ids.includes(id))return;if(ids.length>=5){$("pinnedMessage").textContent="Puoi fissare al massimo 5 crypto.";return}savePinnedIds([...ids,id]);renderOverview()}
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

function renderOverview(){
  const btc=coinById("bitcoin"),eth=coinById("ethereum"); if(!btc||!eth)return;
  $("btc24").textContent=fmtPct(change(btc,"24h")); $("btc24").className=pctClass(change(btc,"24h")); $("btcPrice").textContent=fmtEur(btc.current_price);
  $("eth24").textContent=fmtPct(change(eth,"24h")); $("eth24").className=pctClass(change(eth,"24h")); $("ethPrice").textContent=fmtEur(eth.current_price);
  const top50=state.scored.filter(c=>c.market_cap_rank<=50&&!stableLike(c));
  const breadth=top50.filter(c=>change(c,"7d")>0).length/top50.length*100;
  $("breadth").textContent=`${breadth.toFixed(0)}%`;
  const regimeScore=(btc._score*.4+eth._score*.25+breadth*.35);
  const regime=regimeScore>=65?["Costruttivo","Trend e ampiezza favorevoli.","var(--accent)"]:regimeScore>=48?["Misto","Segnali contrastanti: selettività e size contenute.","var(--yellow)"]:["Difensivo","Momentum o ampiezza deboli: priorità al controllo del rischio.","var(--red)"];
  $("regimeLabel").textContent=regime[0]; $("regimeText").textContent=regime[1]; $("regimeDot").style.background=regime[2];
  const selectedPinned=pinnedIds(),pinned=selectedPinned.map(coinById).filter(Boolean);
  $("pinnedCards").classList.remove("skeleton-grid");
  $("pinnedCards").innerHTML=pinned.length?pinned.map(c=>`<article class="card coin-card" data-id="${c.id}"><div class="coin-top"><div class="coin-id"><img src="${c.image}" alt=""><div><b>${c.name}</b><span>${c.symbol.toUpperCase()} · rank #${c.market_cap_rank}</span></div></div><div class="score ${scoreColor(c._score)}">${c._score}<small>SCORE</small></div></div><div class="coin-stats"><div><span>PREZZO</span><b>${fmtEur(c.current_price)}</b></div><div><span>7 GIORNI</span><b class="${pctClass(change(c,"7d"))}">${fmtPct(change(c,"7d"))}</b></div><div><span>30 GIORNI</span><b class="${pctClass(change(c,"30d"))}">${fmtPct(change(c,"30d"))}</b></div><div><span>RISCHIO</span><b class="${c._risk==='alto'?'negative':c._risk==='medio'?'neutral':'positive'}">${c._risk}</b></div></div></article>`).join(""):`<article class="card pinned-empty"><b>La Home è pronta per essere personalizzata</b><p>Premi “Gestisci” e aggiungi da 1 a 5 crypto che vuoi seguire.</p><button class="primary" data-open-pinned>Configura le posizioni fissate</button></article>`;
  renderPinnedManager();
  document.querySelectorAll("[data-open-pinned]").forEach(button=>button.onclick=()=>{$("pinnedManager").classList.remove("hidden");$("pinnedCoinSelect").focus()});
  document.querySelectorAll(".coin-card").forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
  const candidates=state.scored.filter(eligible).filter(c=>![...selectedPinned,"bitcoin","ethereum"].includes(c.id)).slice(0,6);
  $("topCandidates").innerHTML=candidates.map(c=>`<tr data-id="${c.id}"><td>${coinCell(c)}</td><td class="${scoreColor(c._score)}"><b>${c._score}</b></td><td class="reason">${reasons(c)}</td><td>${fmtEur(c.current_price)}</td><td class="${pctClass(change(c,"7d"))}">${fmtPct(change(c,"7d"))}</td><td class="${pctClass(change(c,"30d"))}">${fmtPct(change(c,"30d"))}</td><td><span class="badge ${c._risk}">${c._risk}</span></td></tr>`).join("");
  bindRows($("topCandidates"));
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

function renderPortfolio(){
  if(!state.portfolio)return;
  const holdings=state.portfolio.holdings;
  $("holdingEditors").innerHTML=holdings.map((h,i)=>{const c=coinById(h.id);return `<article class="card holding-row" data-index="${i}"><div class="holding-name">${c?`<img src="${c.image}" alt="">`:""}<div><b>${c?.name||h.symbol}</b><span>${h.symbol} · ${c?fmtEur(c.current_price):"dato non disponibile"}</span></div></div><label>Quantità<input class="amount" type="number" min="0" step="any" value="${h.amount||""}" placeholder="0"></label><label>Prezzo medio (€)<input class="avg-cost" type="number" min="0" step="any" value="${h.avgCost||""}" placeholder="0"></label><div class="holding-value"><span>VALORE ATTUALE</span><b>${fmtEur((h.amount||0)*(c?.current_price||0))}</b></div></article>`}).join("");
  document.querySelectorAll(".holding-row input").forEach(input=>input.oninput=previewPortfolio);
  previewPortfolio();
}
function portfolioDraft(){return [...document.querySelectorAll(".holding-row")].map(row=>{const original=state.portfolio.holdings[num(row.dataset.index)];return {...original,amount:num(row.querySelector(".amount").value),avgCost:num(row.querySelector(".avg-cost").value)}})}
function previewPortfolio(){
  if(!state.portfolio)return; const holdings=portfolioDraft(); let value=0,cost=0;
  holdings.forEach(h=>{value+=h.amount*num(coinById(h.id)?.current_price);cost+=h.amount*h.avgCost}); const pnl=value-cost,pct=cost?pnl/cost*100:0;
  $("portfolioValue").textContent=fmtEur(value);$("portfolioCost").textContent=fmtEur(cost);$("portfolioPnl").textContent=fmtEur(pnl);$("portfolioPnl").className=pctClass(pnl);$("portfolioPnlPct").textContent=fmtPct(pct);
  renderPortfolioInsights(holdings,value);
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
async function savePortfolio(){try{state.portfolio=await api("/api/portfolio",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({holdings:portfolioDraft()})});renderPortfolio();renderDecisionLab();$("savePortfolio").textContent="Salvato ✓";setTimeout(()=>$("savePortfolio").textContent="Salva portafoglio",1600)}catch(e){showError(e.message)}}

function currentCryptoValues(){
  const values={};let total=0;
  (state.portfolio?.holdings||[]).forEach(h=>{const value=num(h.amount)*num(coinById(h.id)?.current_price);values[h.id]=value;total+=value});
  return {values,total};
}
function renderPlan(){
  if(!state.plan)return;const p=state.plan;
  $("planCapital").value=p.totalInvestableCapital||"";$("planMonthly").value=p.monthlyContribution||"";$("planHorizon").value=p.horizonYears;$("planLoss").value=p.maxToleratedLoss;$("planCryptoMax").value=p.maxCryptoAllocation;$("planCoinMax").value=p.maxSingleCoin;$("planSpecMax").value=p.maxSpeculative;$("planLeverage").value=String(p.allowLeverage);
  if(p.monthlyContribution) $("dcaMonthly").value=p.monthlyContribution;
  const current=currentCryptoValues();
  $("targetRows").innerHTML=p.targets.map((t,i)=>{const c=coinById(t.id);const actual=current.total?num(current.values[t.id])/current.total*100:0;return `<tr data-target-index="${i}"><td>${c?coinCell(c):esc(t.symbol)}</td><td>${actual.toFixed(1)}%</td><td><input class="target-input" type="number" min="0" max="100" step="1" value="${t.target||""}" placeholder="0"></td><td class="target-gap">${(num(t.target)-actual).toFixed(1)} p.p.</td></tr>`}).join("");
  document.querySelectorAll("#plan input,#plan select").forEach(input=>input.oninput=previewPlan);
  previewPlan();
}
function planDraft(){
  const targets=[...document.querySelectorAll("#targetRows tr")].map(row=>{const original=state.plan.targets[num(row.dataset.targetIndex)];return {...original,target:num(row.querySelector(".target-input").value)}});
  return {totalInvestableCapital:num($("planCapital").value),monthlyContribution:num($("planMonthly").value),horizonYears:num($("planHorizon").value),maxToleratedLoss:num($("planLoss").value),maxCryptoAllocation:num($("planCryptoMax").value),maxSingleCoin:num($("planCoinMax").value),maxSpeculative:num($("planSpecMax").value),allowLeverage:$("planLeverage").value==="true",targets};
}
function previewPlan(){
  if(!state.plan||!document.querySelector("#targetRows tr"))return;const p=planDraft(),current=currentCryptoValues();const totalTarget=p.targets.reduce((s,t)=>s+t.target,0);
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
async function savePlan(){try{state.plan=await api("/api/plan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(planDraft())});renderPlan();renderDecisionLab();$("savePlan").textContent="Piano salvato ✓";setTimeout(()=>$("savePlan").textContent="Salva piano",1600)}catch(e){showError(e.message)}}
async function runDca(){
  const button=$("runDca");button.disabled=true;button.textContent="Calcolo…";$("dcaOutput").innerHTML=`<p class="muted">Recupero dello storico in corso…</p>`;
  try{const result=await api(`/api/dca?id=${encodeURIComponent($("dcaCoin").value)}&months=${num($("dcaMonths").value)}&monthly=${num($("dcaMonthly").value)}`);const difference=result.currentValue-result.lumpValue;$("dcaOutput").innerHTML=`<div class="dca-result"><span>CAPITALE VERSATO</span><b>${fmtEur(result.invested)}</b><small>${result.months} acquisti mensili</small></div><div class="dca-result"><span>VALORE DCA OGGI</span><b class="${pctClass(result.returnPct)}">${fmtEur(result.currentValue)}</b><small>${fmtPct(result.returnPct)} · costo medio ${fmtEur(result.averageCost)}</small></div><div class="dca-result"><span>ACQUISTO IMMEDIATO</span><b class="${pctClass(result.lumpReturnPct)}">${fmtEur(result.lumpValue)}</b><small>${fmtPct(result.lumpReturnPct)} · differenza ${difference>=0?'+':''}${fmtEur(difference)} per il DCA</small></div>`}catch(e){$("dcaOutput").innerHTML=`<div class="risk-item danger">${esc(e.message)}</div>`}finally{button.disabled=false;button.textContent="Calcola"}
}

function renderDecisionLab(){
  const previous=$("tradeCoin").value;
  const preferred=["bitcoin","ethereum","polygon-ecosystem-token","algorand","cardano"];
  const universe=state.scored.filter(c=>preferred.includes(c.id)||eligible(c)).sort((a,b)=>{const ai=preferred.indexOf(a.id),bi=preferred.indexOf(b.id);if(ai>=0||bi>=0)return (ai<0?99:ai)-(bi<0?99:bi);return b._score-a._score});
  $("tradeCoin").innerHTML=universe.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.symbol.toUpperCase())}) · score ${c._score}</option>`).join("");
  if(universe.some(c=>c.id===previous)) $("tradeCoin").value=previous;
  ["btc","eth","alt"].forEach(type=>$(type+"Shock").oninput=()=>{updateShockLabels();renderStressTest()});
  updateShockLabels();renderStressTest();renderJournal();
}
function updateShockLabels(){["btc","eth","alt"].forEach(type=>$(type+"ShockLabel").textContent=`${num($(type+"Shock").value).toFixed(0)}%`)}
function analyzeTrade(){
  const c=coinById($("tradeCoin").value);if(!c)return;const amount=num($("tradeAmount").value),action=$("tradeAction").value,portfolio=currentCryptoValues(),currentValue=num(portfolio.values[c.id]);
  let delta=0;if(action==="buy"||action==="rebalance")delta=amount;if(action==="sell")delta=-Math.min(amount,currentValue);const futureTotal=Math.max(0,portfolio.total+delta),futureCoin=Math.max(0,currentValue+delta),futureWeight=futureTotal?futureCoin/futureTotal*100:0,currentWeight=portfolio.total?currentValue/portfolio.total*100:0;
  const items=[];items.push([c._score>=70?"ok":c._score>=52?"warn":"danger",`${c.name}: score ${c._score}/100 · ${reasons(c)} · rischio ${c._risk}.`]);
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
  try{const entry=await api("/api/journal",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});state.journal.unshift(entry);renderJournal();$("saveDecision").textContent="Salvato ✓";setTimeout(()=>$("saveDecision").textContent="Salva nel diario",1400)}catch(e){showError(e.message)}
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
async function deleteJournalEntry(id){if(!confirm("Eliminare questa voce dal diario?"))return;try{await api(`/api/journal?id=${encodeURIComponent(id)}`,{method:"DELETE"});state.journal=state.journal.filter(e=>e.id!==id);renderJournal()}catch(e){showError(e.message)}}

function renderDiscovery(){
  $("trendingCards").innerHTML=state.trending.slice(0,10).map((item,i)=>{const c=coinById(item.id);return `<article class="card trend-card" ${c?`data-id="${esc(c.id)}"`:""}><img src="${esc(item.small||item.thumb)}" alt=""><b>${esc(item.symbol)}</b><span>${esc(item.name)}</span><span class="trend-rank">#${i+1} nelle ricerche${c?` · score ${c._score}`:""}</span></article>`}).join("")||`<p class="muted">Dati trending non disponibili.</p>`;
  document.querySelectorAll(".trend-card[data-id]").forEach(el=>el.onclick=()=>openDetail(el.dataset.id));
  renderNews();
}
async function loadTranslations(){
  try{
    const response=await api("/api/news-translations");
    state.translations=response.translations||{};
    renderNews();
  }catch(error){ /* Il titolo originale resta disponibile. */ }
}
function renderNews(){
  const portfolioTags=new Set(["POL","ALGO","ADA"]);
  const articles=state.news.filter(a=>state.newsFilter==="ALL"||(state.newsFilter==="PORTFOLIO"?a.tags?.some(t=>portfolioTags.has(t)):a.tags?.includes(state.newsFilter)));
  const newsCard=a=>{const when=new Date(a.published),validLink=String(a.link).startsWith("https://")?a.link:"#",isItalian=a.sourceLanguage==="it",translated=isItalian?null:state.translations[a.title];return `<a class="card news-card ${isItalian?'italian-news-card':''}" href="${esc(validLink)}" target="_blank" rel="noopener noreferrer"><div><h3>${esc(translated||a.title)}</h3>${translated&&translated!==a.title?`<div class="news-original">${esc(a.title)}</div>`:""}<span class="news-meta">${esc(a.source)} · ${Number.isNaN(when.valueOf())?"data non disponibile":when.toLocaleString("it-IT",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"})}${isItalian?" · italiano":translated?" · traduzione automatica":" · traduzione in corso"}</span></div><div class="news-tags">${(a.tags||[]).map(t=>`<span>${esc(t)}</span>`).join("")}</div></a>`};
  const italian=state.news.filter(a=>a.source==="Criptovaluta.it").slice(0,8);
  $("italianNewsList").innerHTML=italian.map(newsCard).join("")||`<div class="card insight-card"><p class="muted">Il feed italiano è momentaneamente non disponibile.</p></div>`;
  $("newsList").innerHTML=articles.slice(0,30).map(newsCard).join("")||`<div class="card insight-card"><p class="muted">Nessuna notizia corrisponde al filtro selezionato.</p></div>`;
}

async function openDetail(id){
  const c=coinById(id);if(!c)return; showPage("detail",c.name);$("detailTitle").textContent=`${c.name} (${c.symbol.toUpperCase()})`;$("detailScore").textContent=c._score;
  $("detailMetrics").innerHTML=[['Momentum',c._momentum+'/100'],['Liquidità',c._liquidity+'/100'],['Tokenomics',c._tokenomics+'/100'],['Rischio',c._risk]].map(x=>`<article class="card metric"><span>${x[0]}</span><strong>${x[1]}</strong><small>Indicatore quantitativo</small></article>`).join('');
  try{const history=await api(`/api/history?id=${encodeURIComponent(id)}`);drawChart(history.prices||[])}catch(e){showError(e.message)}
}
function drawChart(points){
  const svg=$("priceChart");if(points.length<2){svg.innerHTML="";return}const values=points.map(p=>p[1]),min=Math.min(...values),max=Math.max(...values),range=max-min||1,pad=20;
  const coords=values.map((v,i)=>[pad+i/(values.length-1)*(1000-pad*2),310-(v-min)/range*270]);
  const line=coords.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');const area=`${line} L980,320 L20,320 Z`;
  svg.innerHTML=`<defs><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79a9ff" stop-opacity=".28"/><stop offset="1" stop-color="#79a9ff" stop-opacity="0"/></linearGradient></defs>${[40,130,220,310].map(y=>`<line class="grid-line" x1="20" y1="${y}" x2="980" y2="${y}"/>`).join('')}<path class="chart-area" d="${area}"/><path class="chart-line" d="${line}"/><text class="chart-label" x="22" y="25">${fmtEur(max)}</text><text class="chart-label" x="22" y="333">${fmtEur(min)}</text>`;
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
  const alerts=buildSmartAlerts();$("alertCount").textContent=`${alerts.length} controlli attivi`;$("smartAlerts").innerHTML=alerts.map(a=>`<article class="smart-alert ${a.level}"><div></div><div><b>${esc(a.title)}</b><span>${esc(a.text)}</span><small>${esc(a.why)}</small></div></article>`).join("");
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
  if(!state.scored.length)return;const paper=paperState(),previous=$("paperCoin").value,preferred=new Set(["bitcoin","ethereum","polygon-ecosystem-token","algorand","cardano"]);$("paperCoin").innerHTML=state.scored.filter(c=>preferred.has(c.id)||eligible(c)).slice(0,100).map(c=>`<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.symbol.toUpperCase())})</option>`).join("");if(state.scored.some(c=>c.id===previous))$("paperCoin").value=previous;
  const rows=Object.entries(paper.positions).map(([id,p])=>{const coin=coinById(id),value=num(p.quantity)*num(coin?.current_price),cost=num(p.quantity)*num(p.avgCost);return {id,...p,coin,value,pnl:value-cost}}).filter(x=>x.quantity>1e-12);const invested=rows.reduce((s,x)=>s+x.value,0),total=paper.cash+invested,pnl=total-paper.initialCash;
  $("paperMetrics").innerHTML=`<article class="card metric"><span>Valore virtuale</span><strong>${fmtEur(total)}</strong><small>Capitale iniziale ${fmtEur(paper.initialCash)}</small></article><article class="card metric"><span>Liquidità</span><strong>${fmtEur(paper.cash)}</strong><small>Disponibile per simulazioni</small></article><article class="card metric"><span>Risultato</span><strong class="${pctClass(pnl)}">${fmtEur(pnl)}</strong><small>${fmtPct(paper.initialCash?pnl/paper.initialCash*100:0)}</small></article>`;
  $("paperPositions").innerHTML=rows.map(x=>`<tr><td>${esc(x.coin?.symbol?.toUpperCase()||x.id)}</td><td>${num(x.quantity).toFixed(6)}</td><td>${fmtEur(x.avgCost)}</td><td>${fmtEur(x.value)}</td><td class="${pctClass(x.pnl)}">${fmtEur(x.pnl)}</td></tr>`).join("")||`<tr><td colspan="5" class="muted">Nessuna posizione virtuale.</td></tr>`;
  $("paperLedger").innerHTML=(paper.trades||[]).slice(0,50).map(t=>`<div class="paper-trade"><b>${new Date(t.date).toLocaleDateString("it-IT")}</b><span>${t.action==="buy"?'Acquisto':'Vendita'}</span><strong>${esc(t.symbol)}</strong><span>${fmtEur(t.amount)} · ${num(t.quantity).toFixed(6)}</span><small>fee ${fmtEur(t.fee)}</small></div>`).join("")||`<p class="muted">Nessuna operazione simulata.</p>`;updatePaperPreview();
}
function updatePaperPreview(){const c=coinById($("paperCoin").value),amount=num($("paperAmount").value),fee=amount*num($("paperFee").value)/100;if(!c)return;$("paperOrderPreview").textContent=`Prezzo indicativo ${fmtEur(c.current_price)} · quantità ${(amount/c.current_price).toFixed(6)} · commissione ${fmtEur(fee)}`}
function executePaper(){
  const paper=paperState(),coin=coinById($("paperCoin").value),action=$("paperAction").value,amount=num($("paperAmount").value),fee=amount*clamp(num($("paperFee").value),0,10)/100;if(!coin||amount<=0)return showError("Importo simulato non valido.");const qty=amount/coin.current_price,pos=paper.positions[coin.id]||{quantity:0,avgCost:0};
  if(action==="buy"){if(paper.cash<amount+fee)return showError("Liquidità virtuale insufficiente.");const newQty=pos.quantity+qty;pos.avgCost=(pos.quantity*pos.avgCost+amount+fee)/newQty;pos.quantity=newQty;paper.cash-=amount+fee}else{if(pos.quantity+1e-12<qty)return showError("Quantità virtuale insufficiente.");pos.quantity-=qty;paper.cash+=amount-fee;if(pos.quantity<1e-12)delete paper.positions[coin.id]}
  if(pos.quantity>=1e-12)paper.positions[coin.id]=pos;paper.trades.unshift({id:crypto.randomUUID(),date:new Date().toISOString(),action,symbol:coin.symbol.toUpperCase(),coinId:coin.id,amount,quantity:qty,price:coin.current_price,fee});savePaper(paper);
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
function renderCopilotSelector(){if(!state.scored.length)return;const previous=$("copilotCoin").value,coins=copilotUniverse();$("copilotCoin").innerHTML=coins.map(c=>`<option value="${esc(c.id)}">${esc(c.name)} (${esc(c.symbol.toUpperCase())}) · score ${c._score}</option>`).join("");if(coins.some(c=>c.id===previous))$("copilotCoin").value=previous}
function taxReadinessState(){return {...{checks:{},totalTx:0,unmatched:0,missingCost:0,unclassified:0,notes:"",updatedAt:null},...localData(copilotStore.fiscal,{})}}
function taxReadinessCalculation(data=taxReadinessState()){const checks=Object.values(data.checks||{}).filter(Boolean).length,checkScore=checks/10*60,total=Math.max(0,num(data.totalTx)),issues=Math.max(0,num(data.unmatched))+Math.max(0,num(data.missingCost))+Math.max(0,num(data.unclassified)),quality=total?clamp(1-issues/Math.max(total,1),0,1)*30:0,inventory=total>0?10:0;return {score:Math.round(checkScore+quality+inventory),checks,issues,total}}
function renderFiscalReadiness(){const data=taxReadinessState(),calc=taxReadinessCalculation(data);$("fiscalTotalTx").value=data.totalTx||"";$("fiscalUnmatched").value=data.unmatched||"";$("fiscalMissingCost").value=data.missingCost||"";$("fiscalUnclassified").value=data.unclassified||"";$("fiscalNotes").value=data.notes||"";document.querySelectorAll("[data-fiscal-ready]").forEach(x=>x.checked=Boolean(data.checks?.[x.dataset.fiscalReady]));$("taxReadinessScore").textContent=`${calc.score}%`;$("taxReadinessLabel").textContent=calc.score>=85?"quasi pronto":calc.score>=60?"da completare":"lacune importanti";$("taxReadinessRing").style.setProperty("--readiness",`${calc.score*3.6}deg`);$("taxReadinessRing").innerHTML=`<b>${calc.score}%</b>`;$("taxReadinessTitle").textContent=calc.score>=85?"Fascicolo ben preparato":calc.score>=60?"Preparazione intermedia":"Preparazione incompleta";$("taxReadinessAdvice").textContent=calc.issues?`${calc.issues} anomalie dichiarate richiedono riconciliazione.`:calc.total?"Nessuna anomalia numerica dichiarata; completa comunque tutti i controlli.":"Registra il totale delle transazioni e completa la checklist.";const gaps=[];if(!calc.total)gaps.push("Inserisci il totale delle transazioni dell’anno.");if(data.unmatched)gaps.push(`${data.unmatched} trasferimenti non sono ancora abbinati.`);if(data.missingCost)gaps.push(`${data.missingCost} operazioni non hanno un costo documentato.`);if(data.unclassified)gaps.push(`${data.unclassified} eventi richiedono classificazione fiscale.`);document.querySelectorAll("[data-fiscal-ready]").forEach(x=>{if(!x.checked)gaps.push(x.parentElement.textContent.trim())});$("fiscalGaps").innerHTML=gaps.slice(0,12).map(x=>`<div class="risk-item ${calc.score<60?'warn':''}">${esc(x)}</div>`).join("")||`<div class="risk-item rule-ok">Tutti i controlli dichiarati risultano completati. Procedi con verifica professionale e istruzioni annuali.</div>`}
function saveFiscalReadiness(){const checks={};document.querySelectorAll("[data-fiscal-ready]").forEach(x=>checks[x.dataset.fiscalReady]=x.checked);saveLocalData(copilotStore.fiscal,{checks,totalTx:Math.max(0,num($("fiscalTotalTx").value)),unmatched:Math.max(0,num($("fiscalUnmatched").value)),missingCost:Math.max(0,num($("fiscalMissingCost").value)),unclassified:Math.max(0,num($("fiscalUnclassified").value)),notes:$("fiscalNotes").value.trim().slice(0,2500),updatedAt:new Date().toISOString()});renderFiscalReadiness();renderBehaviorScore();$("saveFiscalReadiness").textContent="Situazione salvata ✓";setTimeout(()=>$("saveFiscalReadiness").textContent="Salva situazione",1400)}
function sourceLines(){return $("copilotSources").value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).slice(0,12)}
function runCopilot(){const c=coinById($("copilotCoin").value);if(!c)return;const action=$("copilotAction").value,amount=Math.max(0,num($("copilotAmount").value)),fees=clamp(num($("copilotFees").value),0,20),emotion=$("copilotEmotion").value,thesis=$("copilotThesis").value.trim(),invalidation=$("copilotInvalidation").value.trim(),sources=sourceLines(),portfolio=currentCryptoValues(),current=num(portfolio.values[c.id]),direction=action==="buy"?1:action==="sell"?-1:0,projectedCoin=Math.max(0,current+direction*amount),projectedTotal=Math.max(0,portfolio.total+direction*amount),weight=projectedTotal?projectedCoin/projectedTotal*100:0,p=state.plan||{},maxCoin=num(p.maxSingleCoin),capital=num(p.totalInvestableCapital),cryptoAfter=capital?projectedTotal/capital*100:0,scenario=c.id==="bitcoin"?-35:c.id==="ethereum"?-45:-60,scenarioLoss=projectedCoin*Math.abs(scenario)/100,feeCost=amount*fees/100;let quality=100;const findings=[];const add=(level,text)=>findings.push({level,text});add(c._score>=70?"ok":c._score>=52?"warn":"danger",`${c.name}: score ${c._score}/100, rischio ${c._risk}; momentum ${c._momentum}, liquidità ${c._liquidity}, tokenomics ${c._tokenomics}, controllo rischio ${c._riskScore}.`);if(action==="buy"&&maxCoin&&weight>maxCoin){quality-=25;add("danger",`Peso previsto ${weight.toFixed(1)}%: supera il limite personale del ${maxCoin.toFixed(0)}%.`)}else add("ok",`Peso previsto della crypto: ${weight.toFixed(1)}%${maxCoin?` rispetto al limite ${maxCoin.toFixed(0)}%`:"; limite personale non disponibile"}.`);if(action==="buy"&&capital&&cryptoAfter>num(p.maxCryptoAllocation)){quality-=18;add("danger",`Esposizione crypto prevista ${cryptoAfter.toFixed(1)}% del capitale investibile: oltre il limite del ${num(p.maxCryptoAllocation).toFixed(0)}%.`)}else if(action==="buy")add(capital?"ok":"warn",capital?`Esposizione crypto prevista: ${cryptoAfter.toFixed(1)}% del capitale investibile.`:"Compila il capitale investibile per misurare l’esposizione complessiva.");add(scenarioLoss>amount*.5?"warn":"ok",`Scenario didattico ${scenario}% sulla posizione: perdita stimata ${fmtEur(scenarioLoss)}; non è una previsione né una probabilità.`);add(fees>2?"warn":"ok",`Costi inseriti: ${fmtEur(feeCost)} (${fees.toFixed(1)}%). Spread e slippage reali possono essere diversi.`);if(["fomo","paura"].includes(emotion)){quality-=15;add("danger",`Stato emotivo dichiarato: ${emotion.toUpperCase()}. Valuta una pausa e riesamina a mercato invariato.`)}if(thesis.length<40){quality-=15;add("warn","La tesi è assente o troppo breve: descrivi fatti verificabili, orizzonte e motivo economico.")}else add("ok","La tesi ha una struttura minima verificabile.");if(invalidation.length<25){quality-=12;add("warn","Manca una condizione d’invalidazione sufficientemente concreta.")}else add("ok","È presente una condizione per riesaminare la tesi.");if(!sources.length){quality-=10;add("warn","Nessuna fonte registrata: aggiungi documentazione ufficiale e almeno una verifica indipendente.")}else add("ok",`${sources.length} fonti registrate nel passaporto.`);[["copilotPlanCheck",8,"Confronto con il piano"],["copilotProjectCheck",8,"Comprensione del progetto"],["copilotTaxCheck",8,"Controllo fiscale"]].forEach(([id,penalty,label])=>{if(!$(id).checked){quality-=penalty;add("warn",`${label} non confermato.`)}});const taxText=action==="buy"?"Conserva prova del costo, commissioni, data, quantità e cambio in euro.":action==="watch"?"L’osservazione non è un’operazione; nessun evento fiscale viene simulato.":"Vendita, pagamento o alcuni scambi possono avere rilevanza fiscale: conserva valori e verifica la classificazione.";add(action==="watch"?"ok":"warn",taxText);quality=clamp(Math.round(quality));const verdict=quality>=80?["Controllo solido","green-light","I controlli dichiarati sono coerenti; restano rischio di mercato e verifica finale."]:quality>=55?["Da approfondire","yellow-light","Sono presenti lacune o rischi da risolvere prima di decidere."]:["Fermati e riesamina","red-light","Il processo presenta criticità importanti o informazioni insufficienti."];currentCopilotResult={id:crypto.randomUUID(),createdAt:new Date().toISOString(),coinId:c.id,name:c.name,symbol:c.symbol.toUpperCase(),action,amount,fees,emotion,horizon:$("copilotHorizon").value,thesis,invalidation,sources,confirmations:{plan:$("copilotPlanCheck").checked,project:$("copilotProjectCheck").checked,tax:$("copilotTaxCheck").checked},snapshot:{price:c.current_price,score:c._score,risk:c._risk,rank:c.market_cap_rank,marketCap:c.market_cap,volume:c.total_volume,fdvRatio:c._dilution,components:{momentum:c._momentum,liquidity:c._liquidity,tokenomics:c._tokenomics,risk:c._riskScore}},impact:{currentCoinValue:current,projectedCoinValue:projectedCoin,projectedPortfolio:projectedTotal,weight,cryptoAllocation:cryptoAfter,scenario,scenarioLoss,feeCost},processScore:quality,verdict:verdict[0],findings};$("copilotLight").className=`verdict-light ${verdict[1]}`;$("copilotVerdict").textContent=verdict[0];$("copilotVerdictText").textContent=verdict[2];$("copilotMetrics").innerHTML=`<div><span>PROCESSO</span><b>${quality}/100</b></div><div><span>PESO PREVISTO</span><b>${weight.toFixed(1)}%</b></div><div><span>STRESS POSIZIONE</span><b>${fmtEur(scenarioLoss)}</b></div><div><span>COSTI INSERITI</span><b>${fmtEur(feeCost)}</b></div>`;$("copilotFindings").innerHTML=findings.map(x=>`<div class="analysis-item ${x.level}"><span></span><p>${esc(x.text)}</p></div>`).join("");$("savePassport").disabled=false}
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
function saveLocalProfile(){saveLocalData(copilotStore.profile,{name:$("profileName").value.trim().slice(0,60),experience:$("profileExperience").value,goal:$("profileGoal").value,updatedAt:new Date().toISOString()});renderBehaviorScore();renderPrivacy();$("saveLocalProfile").textContent="Profilo salvato ✓";setTimeout(()=>$("saveLocalProfile").textContent="Salva profilo locale",1400)}
function allLocalData(){const data={exportedAt:new Date().toISOString(),version:1,storage:{}};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith("cryptoRadar")){try{data.storage[key]=JSON.parse(localStorage.getItem(key))}catch{data.storage[key]=localStorage.getItem(key)}}}return data}
function downloadAllLocal(){downloadBlob(`crypto-radar-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(allLocalData(),null,2))}
function generateShareReport(){const include=key=>document.querySelector(`[data-share="${key}"]`)?.checked,hide=$("shareHideAmounts").checked,audience=$("shareAudience").value,profile=localProfile(),positions=activePositions(),behavior=behaviorCalculation(),fiscal=taxReadinessState(),passports=localData(copilotStore.passports,[]);const money=x=>hide?"[nascosto]":fmtEur(x),sections=[];if(include("overview"))sections.push(`<h2>Panoramica</h2><table><tr><th>Asset</th><th>Quantità</th><th>Valore</th><th>Peso</th></tr>${positions.map(p=>`<tr><td>${esc(p.symbol)}</td><td>${hide?'[nascosta]':num(p.amount)}</td><td>${money(p.value)}</td><td>${positions.reduce((s,x)=>s+x.value,0)?(p.value/positions.reduce((s,x)=>s+x.value,0)*100).toFixed(1):0}%</td></tr>`).join("")}</table>`);if(include("plan"))sections.push(`<h2>Piano</h2><p>Orizzonte: ${num(state.plan?.horizonYears)} anni · perdita tollerabile ${num(state.plan?.maxToleratedLoss)}% · singola crypto massimo ${num(state.plan?.maxSingleCoin)}% · crypto massimo ${num(state.plan?.maxCryptoAllocation)}%.</p>`);if(include("behavior"))sections.push(`<h2>Disciplina</h2><p>Punteggio di processo: ${behavior.score}/100. Non misura abilità o rendimento.</p>`);if(include("fiscal")){const calc=taxReadinessCalculation(fiscal);sections.push(`<h2>Preparazione fiscale</h2><p>${calc.score}% · ${calc.total} transazioni · ${calc.issues} anomalie dichiarate.</p>${include("notes")?`<p>Note: ${esc(fiscal.notes||"Nessuna")}</p>`:""}`)}if(include("passports"))sections.push(`<h2>Passaporti</h2>${passports.slice(0,20).map(p=>`<div class="box"><b>${esc(p.symbol)} · ${esc(p.action)} · processo ${num(p.processScore)}/100</b><p>${esc(p.thesis||"Tesi assente")}</p></div>`).join("")||"<p>Nessun passaporto.</p>"}`);const html=`<!doctype html><html lang="it"><meta charset="utf-8"><title>Report Crypto Radar</title><style>body{font:15px system-ui;max-width:900px;margin:40px auto;padding:0 20px;color:#17202a}h1{margin-bottom:4px}.meta{color:#667}table{border-collapse:collapse;width:100%}td,th{padding:9px;border:1px solid #ccd;text-align:left}.box{border:1px solid #ccd;padding:12px;margin:8px 0;border-radius:8px}.warning{background:#fff7dd;padding:12px;border-left:4px solid #d99b12}</style><h1>Crypto Radar · Report in sola lettura</h1><p class="meta">Destinatario: ${esc(audience)} · generato ${new Date().toLocaleString("it-IT")} · profilo ${esc(profile.name||"non indicato")}</p><p class="warning">Documento informativo generato dall’utente. Non è consulenza finanziaria o fiscale e non contiene accesso agli account.</p>${sections.join("")}<hr><small>Verificare dati, fonti e documenti originali prima di qualsiasi utilizzo.</small></html>`;downloadBlob(`crypto-radar-report-${audience}-${new Date().toISOString().slice(0,10)}.html`,html,"text/html;charset=utf-8")}
function renderCopilot(){if(!state.scored.length)return;renderCopilotSelector();renderPassports();renderFiscalReadiness();renderScoreChanges();renderBehaviorScore();renderPrivacy()}
const tutorContent={overview:["Leggere la Panoramica","Il regime descrive il contesto; le posizioni fissate sono personali. Apri una scheda per capire score e rischio, poi passa dal Copilota prima di agire.",[["Personalizza Home","overview"],["Controllo 360","copilot"]]],screener:["Usare lo screener","Filtra per liquidità e dimensione. Prezzo unitario basso non significa convenienza: confronta market cap, FDV/MC, rischio e fonti.",[["Apri Metodo","method"],["Guide di analisi","academy"]]],portfolio:["Compilare il portafoglio","Quantità e costo medio servono per valore, P/L e concentrazione. Il risultato mostrato non è un calcolo fiscale certificato.",[["Piano personale","plan"],["Stress test","decision"]]],connections:["Importare senza perdere dati","Usa la cronologia completa, controlla anteprima e duplicati, quindi abbina depositi e prelievi tra wallet propri.",[["Fisco continuo","copilot"],["Guida fiscale","tax"]]],academy:["Percorso guidato","Completa i moduli in ordine oppure usa l’indice. Il progresso aumenta il punteggio di disciplina, non attribuisce competenze professionali.",[["Inizia dalle basi","academy"]]],plan:["Definire limiti prima del mercato","Capitale, perdita tollerabile e concentrazione devono essere sostenibili. Il piano è un vincolo decisionale, non una previsione.",[["Controllo 360","copilot"]]],copilot:["Usare il Copilota 360","Compila tesi, invalidazione e fonti; risolvi gli avvisi prima di salvare il Passaporto. Il semaforo valuta il processo, non dice di comprare.",[["Decision Lab","decision"],["Guida fiscale","tax"]]],decision:["Decision Lab","Confronta la scelta col piano, simula uno shock e salva il ragionamento. “Osservazione” permette di documentare senza operare.",[["Controllo più completo","copilot"]]],operations:["Centro operativo","Gli alert richiedono indagine, il report crea memoria, il paper trading fa pratica e il calendario protegge la routine.",[["Guide dettagliate","academy"]]],news:["Leggere le notizie","Apri la fonte originale, verifica data ed evento e separa attenzione del mercato da qualità del progetto.",[["Guida alle fonti","academy"]]],tax:["Fiscalità italiana","Parti dall’anno corretto, riconcilia tutte le fonti e conserva prova dei costi. Per i casi concreti usa istruzioni annuali e professionista.",[["Indicatore continuo","copilot"]]],method:["Capire lo score","Lo score combina momentum, liquidità, tokenomics e rischio quantitativo. Serve a ordinare approfondimenti, non è una raccomandazione.",[["Variazioni score","copilot"]]],detail:["Dettaglio crypto","Confronta timeframe, volume, diluizione e motivazioni. Un grafico non sostituisce utilità, tokenomics e sicurezza.",[["Prima di comprare","copilot"]]]};
function renderTutor(){const [title,body,actions]=tutorContent[state.currentPage]||tutorContent.overview;$("tutorTitle").textContent=title;$("tutorBody").innerHTML=`<p>${esc(body)}</p><div class="tutor-rule"><b>Domanda guida</b><span>Quale informazione manca prima di poter spiegare questa scelta a un’altra persona?</span></div>`;$("tutorActions").innerHTML=actions.map(([label,page])=>`<button class="secondary" data-tutor-go="${esc(page)}">${esc(label)}</button>`).join("");document.querySelectorAll("[data-tutor-go]").forEach(b=>b.onclick=()=>{showPage(b.dataset.tutorGo);toggleTutor(false)})}
function toggleTutor(open){$("tutorDrawer").classList.toggle("open",open);$("tutorDrawer").setAttribute("aria-hidden",String(!open));if(open)renderTutor()}

function renderOperations(){renderAlerts();renderWeeklyReport();renderPaper();renderCalendar()}

function showPage(id,title){state.currentPage=id;document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===id));document.querySelectorAll('.nav').forEach(n=>n.classList.toggle('active',n.dataset.target===id));$("pageTitle").textContent=title||({overview:'Panoramica',screener:'Opportunity screener',portfolio:'Il mio portafoglio',connections:'Exchange & wallet',academy:'Guide per principianti',plan:'Piano personale',copilot:'Copilota 360',decision:'Decision Lab',operations:'Centro operativo',news:'News & trend',tax:'730 & fiscalità crypto',method:'Metodo & rischio'}[id]||'Analisi');renderTutor();window.scrollTo({top:0,behavior:'smooth'})}
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
document.querySelectorAll('[data-guide-open]').forEach(button=>button.onclick=()=>{const lesson=document.querySelector(`[data-lesson="${button.dataset.guideOpen}"]`);if(!lesson)return;lesson.open=true;lesson.scrollIntoView({behavior:"smooth",block:"start"})});
function renderTaxChecklist(){const checks=[...document.querySelectorAll('[data-tax-check]')],saved=localData("cryptoRadarTaxChecklist",{});checks.forEach((check,index)=>check.checked=Boolean(saved[index]));const done=checks.filter(check=>check.checked).length,pct=checks.length?Math.round(done/checks.length*100):0;if($("taxCheckLabel"))$("taxCheckLabel").textContent=`${done}/${checks.length} documenti controllati`;if($("taxCheckBar"))$("taxCheckBar").style.width=`${pct}%`}
document.querySelectorAll('[data-tax-check]').forEach((check,index)=>check.onchange=()=>{const saved=localData("cryptoRadarTaxChecklist",{});saved[index]=check.checked;saveLocalData("cryptoRadarTaxChecklist",saved);renderTaxChecklist()});
renderTaxChecklist();
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
  try{const data=await api("/api/transactions");$("transactionTotal").textContent=`${data.total} transazioni`;$("importHistory").innerHTML=(data.batches||[]).map(batch=>`<div class="import-batch"><div><b>${esc(batch.exchange?.toUpperCase()||"EXCHANGE")}</b><span>${esc(batch.filename||"CSV")} · ${batch.count} operazioni · ${new Date(batch.importedAt*1000).toLocaleString("it-IT")}</span></div><button class="journal-delete undo-import" data-batch-id="${esc(batch.batchId)}">Annulla</button></div>`).join("")||`<p class="muted">Nessuna importazione salvata.</p>`;document.querySelectorAll('.undo-import').forEach(button=>button.onclick=()=>undoImport(button.dataset.batchId))}catch(error){/* La pagina principale resta utilizzabile. */}
}
async function undoImport(batchId){if(!confirm("Annullare questa importazione e rimuovere tutte le sue operazioni?"))return;try{await api(`/api/import?batchId=${encodeURIComponent(batchId)}`,{method:"DELETE"});await loadImportHistory()}catch(error){showError(error.message)}}
document.querySelectorAll('.nav').forEach(n=>n.onclick=()=>showPage(n.dataset.target));
document.querySelectorAll('[data-go]').forEach(n=>n.onclick=()=>showPage(n.dataset.go));
document.querySelectorAll('[data-ops-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-ops-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.ops-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`ops-${button.dataset.opsTab}`));if(button.dataset.opsTab==="report")renderWeeklyReport();if(button.dataset.opsTab==="paper")renderPaper();if(button.dataset.opsTab==="calendar")renderCalendar()});
document.querySelectorAll('[data-copilot-tab]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-copilot-tab]').forEach(x=>x.classList.toggle('active',x===button));document.querySelectorAll('.copilot-panel').forEach(panel=>panel.classList.toggle('active',panel.id===`copilot-${button.dataset.copilotTab}`));if(button.dataset.copilotTab==="passports")renderPassports();if(button.dataset.copilotTab==="fiscal")renderFiscalReadiness();if(button.dataset.copilotTab==="scores")renderScoreChanges();if(button.dataset.copilotTab==="privacy")renderPrivacy()});
document.querySelectorAll('#newsFilters .chip').forEach(button=>button.onclick=()=>{state.newsFilter=button.dataset.filter;document.querySelectorAll('#newsFilters .chip').forEach(x=>x.classList.toggle('active',x===button));renderNews()});
document.querySelectorAll("[data-stress]").forEach(button=>button.onclick=()=>setStressPreset(button.dataset.stress));
$("refreshBtn").onclick=()=>loadAll(true);$("applyFilters").onclick=renderScreener;$("savePortfolio").onclick=savePortfolio;$("savePlan").onclick=savePlan;$("runDca").onclick=runDca;$("analyzeTrade").onclick=analyzeTrade;$("saveDecision").onclick=saveDecision;$("backBtn").onclick=()=>showPage('overview');
$("managePinned").onclick=()=>{$("pinnedManager").classList.toggle("hidden");if(!$("pinnedManager").classList.contains("hidden"))$("pinnedCoinSelect").focus()};$("closePinned").onclick=()=>$("pinnedManager").classList.add("hidden");$("addPinned").onclick=addPinnedCoin;$("pinnedCoinSelect").onchange=()=>{$("addPinned").disabled=!$("pinnedCoinSelect").value||pinnedIds().length>=5};
$("runCopilot").onclick=runCopilot;$("savePassport").onclick=savePassport;$("saveFiscalReadiness").onclick=saveFiscalReadiness;$("saveScoreSnapshot").onclick=saveScoreSnapshot;$("runSecurityRadar").onclick=runSecurityRadar;$("saveLocalProfile").onclick=saveLocalProfile;$("generateShareReport").onclick=generateShareReport;$("exportAllLocal").onclick=downloadAllLocal;$("downloadLocalData").onclick=downloadAllLocal;$("exportPassports").onclick=()=>downloadBlob(`crypto-radar-passaporti-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(localData(copilotStore.passports,[]),null,2));$("deleteLocalData").onclick=()=>{if(!confirm("Eliminare tutti i dati locali di Crypto Radar da questo browser? L’operazione non può essere annullata senza un backup."))return;[...Array(localStorage.length)].map((_,i)=>localStorage.key(i)).filter(k=>k?.startsWith("cryptoRadar")).forEach(k=>localStorage.removeItem(k));location.reload()};$("tutorToggle").onclick=()=>toggleTutor(!$("tutorDrawer").classList.contains("open"));$("tutorClose").onclick=()=>toggleTutor(false);
$("saveAlertSettings").onclick=saveAlertSettings;$("saveWeeklySnapshot").onclick=saveWeeklySnapshot;$("printWeeklyReport").onclick=()=>window.print();$("paperCoin").onchange=updatePaperPreview;$("paperAmount").oninput=updatePaperPreview;$("paperFee").oninput=updatePaperPreview;$("paperAction").onchange=updatePaperPreview;$("executePaper").onclick=executePaper;$("resetPaper").onclick=resetPaper;$("addCalendarEvent").onclick=addCalendarEvent;$("saveCalendarRoutines").onclick=saveCalendarRoutines;$("exportCalendar").onclick=exportCalendar;
loadAll();
