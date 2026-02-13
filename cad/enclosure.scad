// Anqori AnchorWatch MVP enclosure model.
//
// Exports:
//   part="base"    -> base shell with mounts and cable exits
//   part="cover"   -> cover/lid
//   part="preview" -> base + lifted cover assembly preview
//
// Example:
//   openscad -D 'part="base"' -o cad/out/anchorwatch-base.stl cad/enclosure.scad

part = "base"; // ["base", "cover", "preview"]

// Main envelope (mm)
outer_len = 140;
outer_wid = 92;
base_height = 36;
cover_height = 14;
wall = 3;
floor_thickness = 3;
cover_top_thickness = 3;
fit_clearance = 0.4;

// Internal standoffs (device board + connector stack)
board_center_x = -20;
board_center_y = 0;
board_mount_span_x = 56;
board_mount_span_y = 38;
standoff_outer_d = 7;
standoff_hole_d = 3.2;
standoff_height = 7;

// Siren pocket approximation
siren_center_x = 34;
siren_center_y = 0;
siren_outer_d = 48;
siren_pocket_d = 43;
siren_ring_h = 4;
siren_pocket_depth = 2;

// Cable exits (power + CAN)
power_exit_w = 14;
can_exit_w = 16;
cable_exit_h = 8;
cable_exit_z = floor_thickness + 7;

// Cover screw interface
screw_boss_d = 9;
screw_hole_d = 3.2;
screw_boss_height = base_height - floor_thickness - 2;
screw_edge_offset = 8;

// Exterior mounting ears
ear_d = 16;
ear_hole_d = 5;
ear_offset = 8;
mount_feature_h = floor_thickness + 2;

// Lip for cover fit
lip_thickness = 2.4;

inner_len = outer_len - 2 * wall;
inner_wid = outer_wid - 2 * wall;
lip_depth = cover_height - cover_top_thickness;
lip_outer_len = inner_len - 2 * fit_clearance;
lip_outer_wid = inner_wid - 2 * fit_clearance;
lip_inner_len = lip_outer_len - 2 * lip_thickness;
lip_inner_wid = lip_outer_wid - 2 * lip_thickness;

function screw_pos_x() = inner_len / 2 - screw_edge_offset;
function screw_pos_y() = inner_wid / 2 - screw_edge_offset;

module box_at_center(len, wid, h) {
  translate([-len / 2, -wid / 2, 0]) cube([len, wid, h]);
}

module each_board_mount_position() {
  for (x_dir = [-1, 1]) {
    for (y_dir = [-1, 1]) {
      translate([
        board_center_x + x_dir * board_mount_span_x / 2,
        board_center_y + y_dir * board_mount_span_y / 2,
        0
      ]) children();
    }
  }
}

module each_screw_position() {
  for (x_dir = [-1, 1]) {
    for (y_dir = [-1, 1]) {
      translate([
        x_dir * screw_pos_x(),
        y_dir * screw_pos_y(),
        0
      ]) children();
    }
  }
}

module each_ear_position() {
  for (x_dir = [-1, 1]) {
    for (y_dir = [-1, 1]) {
      translate([
        x_dir * (outer_len / 2 + ear_offset),
        y_dir * (outer_wid / 2 + ear_offset),
        0
      ]) children();
    }
  }
}

module cable_exit_cutouts() {
  // Power exit, left wall.
  translate([
    -outer_len / 2 - 1,
    -outer_wid / 4 - power_exit_w / 2,
    cable_exit_z
  ]) cube([wall + 2, power_exit_w, cable_exit_h]);

  // CAN exit, right wall.
  translate([
    outer_len / 2 - wall - 1,
    outer_wid / 4 - can_exit_w / 2,
    cable_exit_z
  ]) cube([wall + 2, can_exit_w, cable_exit_h]);
}

module mounting_ear_solids() {
  for (x_dir = [-1, 1]) {
    for (y_dir = [-1, 1]) {
      let(
        x_outer = x_dir * (outer_len / 2 + ear_offset),
        y_outer = y_dir * (outer_wid / 2 + ear_offset),
        x_inner = x_dir * (outer_len / 2 - 3),
        y_inner = y_dir * (outer_wid / 2 - 3)
      ) hull() {
        translate([x_outer, y_outer, 0]) cylinder(h = mount_feature_h, d = ear_d, $fn = 48);
        translate([x_inner, y_inner, 0]) cylinder(h = mount_feature_h, d = 10, $fn = 32);
      }
    }
  }
}

module mounting_ear_holes() {
  each_ear_position() {
    translate([0, 0, -0.2]) cylinder(h = mount_feature_h + 0.4, d = ear_hole_d, $fn = 40);
  }
}

module board_standoff_solids() {
  each_board_mount_position() {
    translate([0, 0, floor_thickness]) cylinder(h = standoff_height, d = standoff_outer_d, $fn = 40);
  }
}

module board_standoff_holes() {
  each_board_mount_position() {
    translate([0, 0, floor_thickness - 0.2]) cylinder(h = standoff_height + 0.4, d = standoff_hole_d, $fn = 36);
  }
}

module screw_boss_solids() {
  each_screw_position() {
    translate([0, 0, floor_thickness]) cylinder(h = screw_boss_height, d = screw_boss_d, $fn = 40);
  }
}

module base_screw_holes() {
  each_screw_position() {
    translate([0, 0, floor_thickness - 0.2]) cylinder(h = screw_boss_height + 0.4, d = screw_hole_d, $fn = 36);
  }
}

module cover_screw_holes() {
  each_screw_position() {
    translate([0, 0, -0.2]) cylinder(h = cover_height + 0.4, d = screw_hole_d + 0.3, $fn = 36);
    translate([0, 0, cover_height - 2]) cylinder(h = 2.2, d = 6.5, $fn = 36);
  }
}

module siren_ring_solid() {
  translate([siren_center_x, siren_center_y, floor_thickness]) {
    cylinder(h = siren_ring_h, d = siren_outer_d, $fn = 72);
  }
}

module siren_pocket_cutout() {
  translate([siren_center_x, siren_center_y, floor_thickness]) {
    translate([0, 0, siren_ring_h - siren_pocket_depth]) {
      cylinder(h = siren_pocket_depth + 0.2, d = siren_pocket_d, $fn = 72);
    }
  }
}

module base_shell() {
  difference() {
    box_at_center(outer_len, outer_wid, base_height);
    translate([0, 0, floor_thickness]) box_at_center(inner_len, inner_wid, base_height);
    cable_exit_cutouts();
  }
}

module base_part() {
  difference() {
    union() {
      base_shell();
      board_standoff_solids();
      screw_boss_solids();
      siren_ring_solid();
      mounting_ear_solids();
    }
    board_standoff_holes();
    base_screw_holes();
    siren_pocket_cutout();
    mounting_ear_holes();
  }
}

module cover_body() {
  union() {
    // Top plate.
    translate([0, 0, lip_depth]) box_at_center(outer_len, outer_wid, cover_top_thickness);

    // Inner lip that keys into the base cavity.
    difference() {
      box_at_center(lip_outer_len, lip_outer_wid, lip_depth);
      translate([0, 0, -0.1]) box_at_center(lip_inner_len, lip_inner_wid, lip_depth + 0.2);
    }
  }
}

module cover_part() {
  difference() {
    cover_body();
    cover_screw_holes();
  }
}

module preview_part() {
  color("lightgray") base_part();
  color("silver") translate([0, 0, base_height + 2]) cover_part();
}

if (part == "base") {
  base_part();
} else if (part == "cover") {
  cover_part();
} else {
  preview_part();
}
