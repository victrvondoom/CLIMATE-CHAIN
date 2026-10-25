# Climate Intelligence Timeline — 200 Years of Environmental Evidence

**IEEE ClimateChain Global Hackathon 2026**  
*Scientific Architecture & Historical Methodology Report | Self-reviewed: October 24, 2026*

---

## 1. Scientific Objective & Philosophy

The **Climate Intelligence Timeline** is a research-grade environmental intelligence system enabling users to explore hand-keyed reference values for historical climate observations, atmospheric greenhouse gas concentrations, renewable energy transitions, and documented policy interventions across a 200-year window (1826 to 2026). This repository embeds 108 hand-keyed anchor values; other annual values are linearly interpolated and labelled INTERPOLATED.

### The Golden Rule of Scientific Integrity
In environmental data science, **a dataset with 20,000 rows is not 20,000 datasets**, and **a 200-year window does not mean every region and variable has complete observations**.

Climate Chain strictly adheres to the following principles:
1. **Explicit Data Gaps**: Where instrument records did not exist (e.g., global surface temperature anomaly networks prior to 1880, or international grid fuel statistics prior to 1965), Climate Chain **preserves the data gap explicitly**. It does not invent proxy observations; interpolated years between anchors are linear and labelled INTERPOLATED.
2. **Deterministic Preimage Evidence**: Every data point clicked on the timeline links to an agency citation, data license, measurement uncertainty bound, and a SHA-256 digest of the evidence payload.
3. **No Model-to-Observation Conflation**: Modeled projections, counterfactual baselines, and satellite retrievals are strictly partitioned from ground-truth observed measurements.

---

## 2. Official Scientific Data Sources

Climate Chain catalogues 8 reference datasets (record counts and checksums describe upstream files that are not stored here) in [`climate-chain/registry/datasets.json`](../climate-chain/registry/datasets.json):

### A. Global Surface Temperature Anomaly (1880–2026)
- **Source Agency**: NOAA National Centers for Environmental Information (NCEI) / NASA Goddard Institute for Space Studies (GISS).
- **Dataset**: GISTEMP v4 (`GISTEMP-v4-GLB.Ts+dSST`).
- **Variable**: Surface Temperature Anomaly (°C relative to the GISTEMP native 1951–1980 baseline).
- **Temporal Resolution**: Annual (1880 to 2026).
- **Uncertainty Envelope**: 95% confidence interval accounting for spatial coverage and urban heat island effects (±0.15°C in 1880, reducing to ±0.04°C in 2026).
- **Explicit Gap**: **1826 to 1879**. Prior to 1880, global instrumental weather station networks lacked sufficient spatial density to compute a calibrated global mean.

### B. Atmospheric Carbon Dioxide Concentration (1832–2026)
- **Source Agency**: Australian Antarctic Division (AAD) / CSIRO Oceans and Atmosphere (Law Dome Ice Cores) spliced with NOAA Global Monitoring Laboratory (Mauna Loa Observatory, Hawaii).
- **Dataset**: `NOAA-GML-CO2-MLO-LAWDOME`.
- **Variable**: Atmospheric CO₂ mole fraction in dry air (ppm).
- **Temporal Coverage**:
  - *1832–1958*: Law Dome DSS and DE08 ice core firn air bubbles (Etheridge et al., 1996). Gas age uncertainty ±5 years; measurement precision ±1.2 ppm.
  - *1958–2026*: Continuous non-dispersive infrared / CRDS analyzers at Mauna Loa Observatory (Keeling Curve; Tans & Keeling, 2026). Precision ±0.12 ppm.
- **Explicit Gap**: **1826 to 1831**. Validated annual ice core firn air continuity begins in 1832.

### C. Atmospheric Methane Concentration (1841–2026)
- **Source Agency**: CSIRO Oceans and Atmosphere (Law Dome Ice Cores) spliced with NOAA GML Cooperative Global Air Sampling Network.
- **Dataset**: `NOAA-GML-CH4-GLOBAL`.
- **Variable**: Atmospheric CH₄ mole fraction (ppb).
- **Temporal Coverage**:
  - *1841–1983*: Law Dome ice core firn air (MacFarling Meure et al., 2006). Repeatability ±8.5 ppb.
  - *1984–2026*: NOAA GML Marine Boundary Layer network on WMO X2004A scale. Precision ±0.8 ppb.
- **Explicit Gap**: **1826 to 1840**. Validated annual methane gas analysis begins in 1841.

### D. Global Renewable Electricity Generation Share (1965–2026)
- **Source Agency**: International Renewable Energy Agency (IRENA) / Energy Institute Statistical Review of World Energy.
- **Dataset**: `IRENA-RE-STAT-2026`.
- **Variable**: Share of electricity generated from renewable sources (hydro, wind, solar, bioenergy, geothermal) as percentage of total generation.
- **Historical Trajectory**: 17.2% in 1965 (dominated by hydro) expanding to 33.2% in 2026 (rapid expansion of solar photovoltaics and wind).
- **Explicit Gap**: **1826 to 1964**. Standardized international fuel-by-fuel electricity generation accounting was established in 1965.

---

## 3. Documented Policy Interventions & Science Milestones

The timeline overlays 12 documented legal, scientific, and treaty milestones:

1. **1872**: *Yellowstone National Park Protection Act* (U.S. Statutes at Large, 17 Stat. 32-33). First public conservation domain model.
2. **1896**: *Arrhenius Radiative Greenhouse Model* (Philosophical Magazine, 41, 237-276). First mathematical quantification of CO₂ climate sensitivity.
3. **1958**: *Keeling Continuous Atmospheric CO₂ Monitoring* (Tellus, 12, 200-203). Birth of the empirical Keeling Curve.
4. **1970**: *United States Clean Air Act Amendments* (Public Law 91-604). Catalytic converters & ambient standards.
5. **1972**: *UN Stockholm Declaration on Human Environment* (UN Doc. A/CONF.48/14/Rev.1). Foundation of international environmental law.
6. **1981**: *India Air (Prevention and Control of Pollution) Act* (Act No. 14 of 1981). Establishes CPCB and SPCB enforcement powers.
7. **1987**: *Montreal Protocol on Substances that Deplete the Ozone Layer* (1522 UNTS 3). Documented recovery of stratospheric ozone.
8. **1992**: *United Nations Framework Convention on Climate Change (UNFCCC)* (1771 UNTS 107). Earth Summit in Rio de Janeiro.
9. **1997**: *Kyoto Protocol to the UNFCCC* (2303 UNTS 162). First legally binding emissions caps for Annex I nations.
10. **2015**: *Paris Climate Agreement (COP21)* (54113 UNTS). 1.5°C global warming boundary and Nationally Determined Contributions.
11. **2021**: *Global Methane Pledge (COP26)* (Glasgow Declaration). 30% voluntary methane reduction commitment by 2030.
12. **2026**: *IEEE Climate Chain Trust Firewall Deployment*. Deterministic evidence rule checks (advisory).

---

## 4. Evidence-to-Claim Trust Firewall Integration

When exploring the timeline, any historical observation can be inspected and exported as an evidence manifest:

```
[ User Selects Year 2024 Temperature Anomaly (1.28°C) ]
                         ↓
  Gateway Generates Evidence Manifest (`HIST-TEMPERATURE_ANOMALY-2024`)
  Computes a SHA-256 digest of the payload (observation & metadata)
                         ↓
  User downloads the manifest (SHA-256 over its JSON)
  and pastes it into the Climate Integrity Lab
```

Download the manifest (SHA-256 over its JSON) and paste it into the Integrity Lab; no automatic firewall evaluation or anchoring occurs. The "Verify in Climate Integrity Lab" button only navigates to the Lab.
