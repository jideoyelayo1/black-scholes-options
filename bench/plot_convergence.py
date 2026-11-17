"""Draws bench/mc_convergence.png from bench/mc_raw.csv and bench/mc_convergence.csv.

Run through bench/run.sh, which installs matplotlib into bench/.venv (not a dependency of the C++ code).
Left: the seed-1 estimate with its 95% interval against paths. Right: error against paths on log-log axes.
"""
import csv
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

HERE = Path(__file__).resolve().parent
SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
BLUE, ORANGE = "#2a78d6", "#eb6834"


def read(name):
    with open(HERE / name, newline="") as f:
        return list(csv.DictReader(f))


summary = read("mc_convergence.csv")
seed1 = [row for row in read("mc_raw.csv") if row["seed"] == "1"]
closed_form = float(summary[0]["closed_form"])
replicates = int(summary[0]["replicates"])

paths = np.array([float(r["paths"]) for r in summary])
rmse = np.array([float(r["rmse"]) for r in summary])
mean_se = np.array([float(r["mean_std_error"]) for r in summary])
slope, intercept = np.polyfit(np.log10(paths), np.log10(rmse), 1)

plt.rcParams.update({"font.size": 10, "axes.edgecolor": MUTED, "axes.labelcolor": INK, "xtick.color": MUTED,
                     "ytick.color": MUTED, "text.color": INK, "axes.spines.top": False, "axes.spines.right": False})
fig, (left, right) = plt.subplots(1, 2, figsize=(11, 4.2), facecolor=SURFACE)
for ax in (left, right):
    ax.set_facecolor(SURFACE)
    ax.grid(True, which="major", color=GRID, linewidth=0.8)
    ax.set_xscale("log")
    ax.set_xlabel("number of simulated paths (log scale)")

x = np.array([float(r["paths"]) for r in seed1])
left.fill_between(x, [float(r["ci_low"]) for r in seed1], [float(r["ci_high"]) for r in seed1], color=BLUE, alpha=0.18,
                  linewidth=0, label="95% interval")
left.plot(x, [float(r["estimate"]) for r in seed1], color=BLUE, linewidth=2, marker="o", markersize=5, label="estimate, seed 1")
left.axhline(closed_form, color=MUTED, linewidth=1.2, linestyle="--")
left.annotate(f"Black–Scholes {closed_form:.4f}", (x[-1], closed_form), xytext=(0, 8), textcoords="offset points",
              ha="right", color=MUTED)
left.set_ylabel("call price estimate")
left.set_title("Estimate and its 95% interval, one seed", loc="left", fontsize=11)
left.legend(frameon=False, loc="lower right")

right.set_yscale("log")
right.plot(paths, rmse, color=BLUE, linewidth=2, marker="o", markersize=6, label=f"RMS error over {replicates} seeds")
right.plot(paths, mean_se, color=ORANGE, linewidth=2, marker="s", markersize=5, linestyle=":", label="mean reported standard error")
right.plot(paths, 10 ** (intercept + slope * np.log10(paths)), color=MUTED, linewidth=1, linestyle="--",
           label=f"least-squares fit, slope {slope:.3f}")
right.set_ylabel("absolute error against the closed form")
right.set_title("Error against paths, log–log", loc="left", fontsize=11)
right.legend(frameon=False, loc="lower left")

fig.suptitle("Monte Carlo price of a European call: S = K = 100, σ = 20%, r = 3%, T = 1 year", x=0.01, ha="left",
             fontsize=12)
fig.tight_layout()
fig.savefig(HERE / "mc_convergence.png", dpi=150, facecolor=SURFACE)
print(f"wrote {HERE / 'mc_convergence.png'}; rmse slope from numpy.polyfit {slope:.4f}")
