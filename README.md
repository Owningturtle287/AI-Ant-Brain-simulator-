# Fire Ant Lab

AI Ant Brain Simulator · Phase 2, brain and embodied foraging

A mobile-first 3D simulator of a red imported fire ant worker (*Solenopsis invicta*). The 3.5 mm model has an articulated head, mandibles, six legs, ten segments per antenna, two waist segments, and a tapering, segmented gaster. The head, mesosoma, waist, mouthparts, and limbs use custom-contoured surfaces based on worker photographs and measured anatomy. The walking controller keeps stance feet and their angles fixed in world coordinates. It predicts the trajectory during each swing, shortening the steps on the inside of a curve, and adjusts toe lift to terrain. The head leads a turn while the waist and abdomen follow with a delay. The gait is a procedural tripod model informed by comparative ant research. The primary renderer uses WebGL 2. A compatibility view projects the same rig and motion onto a 2D canvas when WebGL is unavailable. Joint limits, compliance, and kinematics are approximations.

The head turns side to side, tilts up and down, and rolls at the neck. The petiole, postpetiole, and gaster share the bend through the waist. In a tight turn the head can rotate about 38° from the trunk, with a comparable total side bend at the abdomen. These angles are animation estimates informed by comparative ant anatomy. In **Specimen**, use **Extend sting** to reveal the curved tip and **Side** to inspect the segmented abdomen.

## Worker brain and behavior

The worker explores or follows a bilateral odor gradient sampled around its antennae. Food contact interrupts walking so the worker can sample and pick up a crumb. It then uses estimated displacement to return to the nest and reinforces the simulated trail on the way. The Brain tab shows the current firing count, an anatomical projection in front and rear views, and sampled neurons with inspectable inputs. Choose **Place food**, then tap the arena to move the food. **Show trail** reveals the scent deposits. **Clear trail** lets the worker search on its own. Reset restores the starter trail and food.

The published fire-ant worker anatomy labels select receptor-expressing neurons. The 250,000-neuron total is this project's modeling target. The distribution is provisional. The mushroom body allocation uses a comparative anchor from a single-cell atlas reporting about 24% Kenyon cells in the whole-brain profiles of Pharaoh ants. The other allocations are modeling assumptions based on the observed regions and their proposed functions. The location of each displayed neuron is an illustrative placement within its model region.

| Population | Modeled neurons | Allocation basis |
| --- | ---: | --- |
| Mushroom bodies | 60,000 | 24% comparative Kenyon-cell prior |
| Antennal lobes | 18,000 | Provisional bilateral olfactory processing |
| Optic lobes | 12,000 | Provisional small visual populations |
| Lateral horns | 14,000 | Provisional olfactory relay populations |
| Central complex | 9,000 | Provisional midline orientation and steering |
| Subesophageal zone and modeled descending relays | 24,000 | Provisional contact, taste, and motor output |
| Other central brain | 113,000 | Remaining central and relay populations |
| **Total** | **250,000** | **Modeling target** |

All 250,000 units have individual membrane state, thresholds, firing history, and three seeded synapses each. The solver advances in 50 ms steps with separate left and right channels. It reads the previous step’s firing traces through 750,000 synthetic weighted synapses. Comparative insect anatomy informs the region-level projections. The model uses explicit sensory and foraging rules to drive these circuits, and the resulting motor population activity sets pace and yaw during autonomous movement. The previously developed leg controller converts this output into a coordinated gait. Guide and keyboard modes override locomotion for inspection. The viewer draws a sample of actual model events, with connection lines lit when their source fired in the previous model step.

## Run locally

Requires Node.js 22.12+ or 24.

```sh
npm ci
npm run dev
npm test
npm run build
```

For a local offline-install test, run `npm run preview` after building. To run the browser smoke checks, install the test browser with `npx playwright install chromium` and run `npm run test:browser`.

## Phone installation

GitHub Pages can deploy the `Deploy Fire Ant Lab` workflow after the repository's **Settings → Pages → Source** is set to **GitHub Actions**. The resulting Actions run exposes the live site link in its deployment and run summary.

Open the deployment link. On iOS, use **Safari → Share → Add to Home Screen** and turn on **Open as Web App** where available. On Android, use **Chrome → Install app** or **Add to Home screen**. The production app caches its assets for offline use after the first successful load.

## Research

- [AntWeb fire ant worker specimen views](https://www.antweb.org/images.do?caste=worker&genus=solenopsis&project=allantwebants&rank=species&species=invicta&subfamily=myrmicinae)
- [Worker proportions and body-size scaling](https://doi.org/10.1093/jis/3.1.2)
- [Worker morphology, UF/IFAS](https://ask.ifas.ufl.edu/publication/in352)
- [Fire ant motion and stability in tunnels](https://doi.org/10.1073/pnas.1302428110)
- [Comparative tripod stepping patterns in ants](https://pubmed.ncbi.nlm.nih.gov/9317406/)
- [Comparative ant neck and thorax anatomy](https://doi.org/10.1186/s12983-020-00375-9)
- [Ant head movements during walking and scanning](https://pmc.ncbi.nlm.nih.gov/articles/PMC3886322/)
- [Comparative ant abdominal articulation and musculature](https://doi.org/10.1002/jmor.21471)

- [Fire-ant worker neuroanatomy across subcastes](https://doi.org/10.1371/journal.pone.0083966)
- [Comparative ant neuropil and fiber atlas](https://doi.org/10.3389/fnana.2014.00166)
- [Hymenoptera brain-cell allometry](https://doi.org/10.1098/rspb.2021.0199)
- [Comparative single-cell atlas and Kenyon-cell proportions](https://doi.org/10.1038/s41559-022-01784-1)
- [Insect central-complex navigation and steering](https://pmc.ncbi.nlm.nih.gov/articles/PMC6474401/)
- [Fire-ant worker foraging, scouting, and recruitment](https://doi.org/10.1673/031.011.0126)
- [Fire-ant trail orientation behavior](https://www.ars.usda.gov/arsuserfiles/60360510/publications/Vander_Meer_et_al-1990%28M-2399%29.pdf)
