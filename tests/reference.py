"""Independent SciPy check of the classroom post-split falling-body ODE."""
import json,subprocess
from pathlib import Path
import scipy
from scipy.integrate import solve_ivp
root=Path(__file__).resolve().parents[1]
js="""require('./dist/physics.js');require('./dist/staging.js');const e=new Staging.Sequence();e.start();for(let i=0;i<1600;i++)e.step(.005);const initial=JSON.parse(JSON.stringify({upper:e.upper,booster:e.booster}));for(let i=0;i<400;i++)e.step(.005);console.log(JSON.stringify({initial,final:{upper:e.upper,booster:e.booster}}));"""
data=json.loads(subprocess.check_output(['node','-e',js],cwd=root,text=True))
report={'scipy':scipy.__version__,'interval_after_split_seconds':2,'checks':{}}
for name,b in data['initial'].items():
 def rhs(t,y):return [y[1],-9.81-.5*1.225*.45*b['area']*y[1]*abs(y[1])/b['mass']]
 sol=solve_ivp(rhs,(0,2),[b['h'],b['v']],method='DOP853',rtol=1e-11,atol=1e-12)
 assert sol.success
 actual=data['final'][name]
 errors=[abs(sol.y[0,-1]-actual['h']),abs(sol.y[1,-1]-actual['v'])]
 assert max(errors)<.001,errors
 report['checks'][name]={'height_error_m':errors[0],'velocity_error_m_s':errors[1]}
print(json.dumps(report,indent=2))
