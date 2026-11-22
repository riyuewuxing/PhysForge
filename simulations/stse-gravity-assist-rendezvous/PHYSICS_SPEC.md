# S04 深空引力弹弓与空间站轨道交会对接（stse-gravity-assist-rendezvous）

## 1. 辛积分双星掠飞引力弹弓（`mode = 'gravity-assist'`）
- 四阶 Yoshida / 辛 Velocity-Verlet 积分三体引力场：恒星 ($\mu_s=1$) 与沿圆轨 $r_p$ 匀速运动的行星 ($\mu_p \ll \mu_s$)；支持**日心惯性系**与**行星共动系**切换。
- 在行星共动系下，进入双曲线渐近速率 $v_{\infty,\text{in}}$ 与出射渐近速率 $v_{\infty,\text{out}}$ 误差 $< 10^{-5}$；绕行星背向（`trailing`）借力使日心动能严格增加，绕行星前侧（`leading`）借力使日心动能严格减小。

## 2. 空间站轨道交会对接（`mode = 'rendezvous'`）
- 同圆轨目标舱略领先追踪舱 $\Delta\theta > 0$：若正向切向加速 $+\Delta v_\theta$，追踪舱进入周期更长的外切椭圆，经目标舱一整周期 $T_0$ 后反而在相角上**更加落后**；先逆向减速切入内侧较低轨道后周期更短，方可实现高效追赶交会。
