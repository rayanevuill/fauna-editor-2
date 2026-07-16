/* Importer v2 : HTML (EN+FR) -> state v2 (modèle ordonné, bilingue). Node + navigateur (DOMParser). */
(function(root,factory){ if(typeof module==="object"&&module.exports) module.exports=factory(require("node-html-parser")); else root.FaunaImporter2=factory(null); })(typeof self!=="undefined"?self:this,function(NHP){
  "use strict";
  function getParser(){ if(NHP) return html=>NHP.parse(html,{blockTextElements:{script:false,style:false}}); if(typeof DOMParser!=="undefined") return html=>new DOMParser().parseFromString(html,"text/html"); throw new Error("no parser"); }
  const unesc=s=>(s||"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,"&");
  function fullText(el){ if(!el)return ""; let h=el.innerHTML; h=h.replace(/<\/?span[^>]*>/g,"").replace(/<em>([\s\S]*?)<\/em>/g,"*$1*").replace(/<ref>(\d+)<\/ref>/g,(m,n)=>"{{r"+n+"}}").replace(/<[^>]+>/g,""); return unesc(h).replace(/\s+/g," ").trim(); }
  const attr=(el,n)=>el&&el.getAttribute?el.getAttribute(n):null;
  function iconOf(el){ if(!el)return null; const i=el.querySelector("i.fas"); if(!i)return null; return (attr(i,"class")||"").split(/\s+/).find(x=>/^fa-/.test(x)); }
  function capOf(im,lang){ const dcf=attr(im,"data-caption-fr"),dc=attr(im,"data-caption"); if(lang==="fr"&&dcf)return capText(dcf); if(dc)return capText(dc); const capEl=im.parentNode.querySelector('[class$="-caption"] span, .distribution-map-caption span'); return capEl?fullText(capEl):""; }
  function capText(h){ return unesc(String(h||"").replace(/<em>([\s\S]*?)<\/em>/g,"*$1*").replace(/<ref>(\d+)<\/ref>/g,function(m,n){return "{{r"+n+"}}";}).replace(/<[^>]+>/g,"")).replace(/\s+/g," ").trim(); }
  function imgOf(im,lang){ return {src:unesc(attr(im,"src")||""),alt:unesc(attr(im,"alt")||""),cap:capOf(im,lang)}; }
  function galImgs(node,lang){ return node.querySelectorAll("img").map(im=>imgOf(im,lang)); }

  function parseChildren(el,lang){
    const items=[];
    el.childNodes.filter(n=>n.nodeType===1).forEach(node=>{
      const cls=attr(node,"class")||"", tag=(node.tagName||"").toUpperCase();
      if(tag==="P"){ items.push({kind:"text",text:fullText(node)}); return; }
      if(tag==="H4"||tag==="H5"){ items.push({kind:"heading",level:tag.toLowerCase(),text:fullText(node)}); return; }
      if(/gallery-distribution-map/.test(cls)){ items.push({kind:"distribution-map",images:galImgs(node,lang)}); return; }
      if(/gallery-full-width/.test(cls)){ items.push({kind:"gallery-full-width",images:galImgs(node,lang)}); return; }
      if(/gallery-16-9/.test(cls)){ items.push({kind:"gallery-16-9",images:galImgs(node,lang)}); return; }
      if(/gallery-2-3/.test(cls)){ items.push({kind:"gallery-2-3",images:galImgs(node,lang)}); return; }
      if(/gallery-5-4-slideshow/.test(cls)){ const gc=node.querySelector(".gallery-5-4-global-caption"); items.push({kind:"gallery-5-4",images:galImgs(node,lang),globalCap:gc?fullText(gc):""}); return; }
      if(/\bsub-section\b/.test(cls)){ const hc=node.querySelector(".sub-section-header-content"); const t=hc?hc.querySelector("span"):null; const body=node.querySelector(".sub-section-body")||node; items.push({kind:"sub-section",title:t?fullText(t):"",icon:iconOf(hc)||"fa-cogs",items:parseChildren(body,lang)}); return; }
      if(tag==="UL"){ const lis=node.childNodes.filter(n=>(n.tagName||"").toUpperCase()==="LI").map(li=>({kind:"text",text:fullText(li)})); items.push({kind:"list",items:lis}); return; }
      if(/subspecies-accordion/.test(cls)){ const t=node.querySelector(".subspecies-header span"); const gc=node.querySelector(".gallery-5-4-global-caption"); const body=node.querySelector(".subspecies-body")||node; items.push({kind:"subspecies",title:t?fullText(t):"",globalCap:gc?fullText(gc):"",items:parseChildren(body,lang)}); return; }
    });
    return items;
  }
  function codeFromLabel(label,table,lang){ label=(label||"").trim().toLowerCase(); const h=table.find(x=>(x[lang]||"").trim().toLowerCase()===label||(x.en||"").trim().toLowerCase()===label); return h?h.c:null; }
  const IUCN=[{c:"EX",en:"Extinct",fr:"Éteint"},{c:"EW",en:"Extinct in the Wild",fr:"Éteint à l'état sauvage"},{c:"CR",en:"Critically Endangered",fr:"En danger critique"},{c:"EN",en:"Endangered",fr:"En danger"},{c:"VU",en:"Vulnerable",fr:"Vulnérable"},{c:"NT",en:"Near Threatened",fr:"Quasi menacé"},{c:"LC",en:"Least Concern",fr:"Préoccupation mineure"},{c:"DD",en:"Data Deficient",fr:"Données insuffisantes"},{c:"NE",en:"Not Evaluated",fr:"Non évalué"}];
  const TREND=[{c:"decreasing",en:"Decreasing",fr:"En déclin"},{c:"stable",en:"Stable",fr:"Stable"},{c:"increasing",en:"Increasing",fr:"En augmentation"},{c:"unknown",en:"Unknown",fr:"Inconnu"}];

  function parseLang(html,lang){
    const root=getParser()(html);
    const q=s=>root.querySelector(s);
    const name=fullText(q(".species-names h1"));
    const sciEl=q(".species-names .scientific-name em")||q(".species-names .scientific-name");
    const sci=sciEl?fullText(sciEl):"";
    const stv=root.querySelectorAll(".conservation-status-band .status-value span").map(x=>fullText(x)).filter(Boolean);
    const statusCode=codeFromLabel(stv[0],IUCN,lang);
    const trendCode=codeFromLabel(stv[1],TREND,lang);
    const introEl=q(".intro-text p span")||q(".intro-text p");
    const intro=introEl?fullText(introEl):"";
    const sp=q("#species-image"), mp=q("#map-image");
    const introImg=sp?unesc(attr(sp,"src")):"";
    const introMap=mp?unesc(attr(mp,"src")):"";
    const sections=[]; let refs=[];
    root.querySelectorAll(".accordion-item").forEach(item=>{
      if(item.querySelector(".references-list")){ item.querySelectorAll(".references-list li").forEach(li=>refs.push(unesc((li.innerHTML||"").trim()))); return; }
      const hc=item.querySelector(".accordion-header-content");
      const body=item.querySelector(".accordion-body");
      sections.push({title:hc?fullText(hc.querySelector("span")):"",icon:iconOf(hc)||"fa-leaf",items:body?parseChildren(body,lang):[]});
    });
    return {name,sci,intro,introImg,introMap,sections,statusCode,trendCode,refs};
  }
  // construit le state complet à partir des fichiers EN + FR (FR optionnel)
  function buildState(enHtml, frHtml){
    const en=parseLang(enHtml,"en");
    const fr=frHtml?parseLang(frHtml,"fr"):null;
    const refs=(en.refs||[]).map((t,i)=>({key:"r"+(i+1),text:t}));
    const langs={en:{name:en.name,sci:en.sci,intro:en.intro,introImg:en.introImg,introMap:en.introMap,sections:en.sections}};
    if(fr) langs.fr={name:fr.name,sci:fr.sci,intro:fr.intro,introImg:fr.introImg,introMap:fr.introMap,sections:fr.sections};
    return {statusCode:en.statusCode||"LC",trendCode:en.trendCode||"decreasing",refs,langs};
  }
  return {parseLang,buildState};
});
