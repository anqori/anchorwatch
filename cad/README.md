# CAD

Mechanical assets for the Anqori AnchorWatch enclosure.

## MVP spec

- printable STL case for device board + connectors + siren
- cover and base with mounting features
- cable exits for power, CAN

Current model interpretation (v0 draft):

- 2-piece enclosure (`base` + `cover`)
- board standoffs in base for MCU/CAN stack mounting
- siren pocket in base
- external mounting ears with screw holes
- dedicated side exits:
  - power cable exit
  - CAN cable exit

## Files

- `cad/enclosure.scad`: parametric OpenSCAD model source
- `cad/generate-stl.sh`: STL export script
- `cad/out/`: generated STL outputs

## Requirements

- OpenSCAD CLI (`openscad`) installed and available in `PATH`

## Generate STL

From repo root:

```bash
cad/generate-stl.sh
```

This exports:

- `cad/out/anchorwatch-base.stl`
- `cad/out/anchorwatch-cover.stl`

Optional targets:

```bash
cad/generate-stl.sh base
cad/generate-stl.sh cover
cad/generate-stl.sh preview
```

## Tuning dimensions

Edit the constants at the top of `cad/enclosure.scad`:

- enclosure envelope (`outer_len`, `outer_wid`, `base_height`, `cover_height`)
- wall/floor/fit (`wall`, `floor_thickness`, `fit_clearance`)
- board mount spacing (`board_mount_span_x`, `board_mount_span_y`)
- siren pocket (`siren_pocket_d`, `siren_pocket_depth`)
- cable exits (`power_exit_w`, `can_exit_w`, `cable_exit_h`)
