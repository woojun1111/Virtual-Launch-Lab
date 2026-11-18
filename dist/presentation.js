/* Presentation only: never used as inputs to the physics solver. */
(function(root){'use strict';
const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*x*(10+x*(-15+6*x));};
function pose(o,illustration=true){const t=o.separated?Math.max(0,o.time-(o.separationTime??8)):0;
 const tb=o.boosterImpactTime==null?t:Math.max(0,o.boosterImpactTime-(o.separationTime??8));
 const tu=o.upperImpactTime==null?t:Math.max(0,o.upperImpactTime-(o.separationTime??8));
 const blend=illustration?smooth(tb/3):0,upperBlend=illustration?smooth(tu/3):0;
 // Artistic orientation/spacing: no fitted coefficients, forces or attitude solver.
 const angle=illustration?blend*(.25*Math.sin(tb*.65)+.16*tb):0;
 return {booster:{x:blend?-.7*blend:0,angle,roll:illustration?.12*blend*Math.sin(tb*.4):0},upper:{x:.7*upperBlend,angle:upperBlend?-.12*upperBlend:0,roll:0},blend};
}
root.LaunchPresentation={smooth,pose};
})(globalThis);
