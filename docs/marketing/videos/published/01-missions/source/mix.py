import numpy as np, soundfile as sf
SR=48000; TOT=30.667
m,_=sf.read("music.wav"); n=min(int(round(TOT*SR)),len(m)); m=m[:n]
if m.ndim==1: m=np.stack([m,m],1)
t=np.arange(n)/SR
def ramp(a,b,lo,hi): return lo+(hi-lo)*np.clip((t-a)/(b-a),0,1)
env=ramp(2.90,3.70,0.0,1.0)                 # silent under the deadpan hook, in with B
env*=np.where(t<19.70,1.0,0.14+(1-0.14)*ramp(22.50,23.20,0.0,1.0))   # drop for the 107 reveal
env*=ramp(29.60,30.60,1.0,0.0)
sf.write("music_env.wav",m*env[:,None],SR)
print(f"env 1s={env[int(1*SR)]:.2f} 8s={env[int(8*SR)]:.2f} 21s={env[int(21*SR)]:.2f} 26s={env[int(26*SR)]:.2f}")
