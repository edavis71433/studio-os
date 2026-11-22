(function(){var r=document.documentElement,h=document.querySelector("header.site"),b=h&&h.querySelector(".menu-btn"),m=h&&h.querySelector(".site-menu");function size(){var p=h?getComputedStyle(h).position:"";r.style.setProperty("--hdr-h",(h&&(p==="sticky"||p==="fixed")?h.offsetHeight:0)+"px")}
size();window.addEventListener("resize",size);if(!b||!m)return;var mq=window.matchMedia("(max-width:720px)");function set(on){m.classList.toggle("open",on);b.setAttribute("aria-expanded",on?"true":"false");if(on)h.classList.remove("dds-hdr-off")}
b.addEventListener("click",function(){set(!m.classList.contains("open"))}
);document.addEventListener("keydown",function(e){if(e.key==="Escape"&&m.classList.contains("open")){set(false);b.focus()}
}
);document.addEventListener("click",function(e){if(m.classList.contains("open")&&!h.contains(e.target))set(false)}
);if(mq.addEventListener)mq.addEventListener("change",function(){if(!mq.matches)set(false)}
);m.addEventListener("click",function(e){if(!mq.matches)return;var a=e.target.closest&&e.target.closest("li.has-sub>a");if(!a||!m.contains(a))return;var li=a.parentNode,open=li.classList.contains("open");if(a.getAttribute("role")==="button"||!open){e.preventDefault();li.classList.toggle("open",!open);a.setAttribute("aria-expanded",open?"false":"true")}
}
);m.addEventListener("keydown",function(e){var t=e.target;if((e.key==="Enter"||e.key===" ")&&t&&t.matches&&t.matches("li.has-sub>a[role=button]")){e.preventDefault();t.click()}
}
)}
)();
(function(){function go(h){location.replace(h)}
var last=null;function cur(){var h=location.hash.slice(1),t=h&&document.getElementById(h);return t&&t.classList.contains("lb")?t:null}
function sync(){var lb=cur();if(lb&&lb!==last){var c=lb.querySelector(".lb-close");if(c)c.focus()}
else if(!lb&&last){var a=document.querySelector("a.ga-zoom[href=\"#"+last.id+"\"]");if(a)a.focus()}
last=lb}
if(document.querySelector(".lb")){window.addEventListener("hashchange",sync);sync();document.addEventListener("click",function(e){var a=e.target.closest&&e.target.closest(".lb a[href^=\"#\"]");if(a){e.preventDefault();go(a.getAttribute("href"))}
}
);document.addEventListener("keydown",function(e){var lb=last;if(!lb)return;if(e.key==="Escape"){e.preventDefault();go(lb.querySelector(".lb-close").getAttribute("href"));return}
if(e.key==="ArrowLeft"||e.key==="ArrowRight"){var n=lb.querySelector(e.key==="ArrowLeft"?".lb-prev":".lb-next");if(n){e.preventDefault();go(n.getAttribute("href"))}
return}
if(e.key==="Tab"){var f=lb.querySelectorAll("a[href]:not([tabindex=\"-1\"])");if(!f.length)return;var a0=f[0],a1=f[f.length-1];if(e.shiftKey&&document.activeElement===a0){e.preventDefault();a1.focus()}
else if(!e.shiftKey&&document.activeElement===a1){e.preventDefault();a0.focus()}
}
}
);var x0=null;document.addEventListener("touchstart",function(e){if(last)x0=e.touches[0].clientX}
,{passive:true}
);document.addEventListener("touchend",function(e){if(!last||x0===null)return;var dx=e.changedTouches[0].clientX-x0;x0=null;if(Math.abs(dx)<40)return;var n=last.querySelector(dx>0?".lb-prev":".lb-next");if(n)go(n.getAttribute("href"))}
,{passive:true}
)}
[].forEach.call(document.querySelectorAll(".block-carousel .carousel"),function(c){var t=c.querySelector(".cr-track"),s=t?t.querySelectorAll(".cr-slide"):[];if(s.length<2)return;function mk(cls,label,txt){var b=document.createElement("button");b.type="button";b.className=cls;b.setAttribute("aria-label",label);b.textContent=txt;return b}
var nav=document.createElement("div");nav.className="cr-nav";var prev=mk("cr-prev","Previous slide","‹"),next=mk("cr-next","Next slide","›");var dots=document.createElement("div");dots.className="cr-dots";dots.setAttribute("role","group");dots.setAttribute("aria-label","Slides");var ds=[];function at(){var w=s[0].offsetWidth+12;return Math.min(s.length-1,Math.max(0,Math.round(t.scrollLeft/w)))}
function to(i){i=(i+s.length)%s.length;t.scrollTo({left:s[i].offsetLeft-s[0].offsetLeft,behavior:"smooth"}
)}
function mark(){var i=at();ds.forEach(function(d,j){d.setAttribute("aria-current",j===i?"true":"false")}
)}
[].forEach.call(s,function(_,i){var d=mk("cr-dot","Slide "+(i+1)+" of "+s.length,"");d.addEventListener("click",function(){to(i)}
);dots.appendChild(d);ds.push(d)}
);prev.addEventListener("click",function(){to(at()-1)}
);next.addEventListener("click",function(){to(at()+1)}
);t.addEventListener("scroll",function(){requestAnimationFrame(mark)}
,{passive:true}
);mark();nav.appendChild(prev);nav.appendChild(dots);nav.appendChild(next);c.appendChild(nav);var h=c.parentNode.querySelector(".cr-hint");if(h)h.hidden=true}
)}
)();