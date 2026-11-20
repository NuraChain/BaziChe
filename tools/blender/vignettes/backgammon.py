import json
import math
import os

import bpy

from lib import kit
from lib import looks
from lib import pieces
from lib import settle
from lib import studio

TOP = studio.PLINTH_HEIGHT
WIDTH = 0.46
THICKNESS = 0.026
FIELD_TOP = TOP + THICKNESS

LIGHT = {24: 2, 13: 5, 8: 3, 6: 5}
DARK = {1: 2, 12: 5, 17: 3, 19: 5}


def build():
    with open(os.path.join(kit.ART, 'backgammon.json'), encoding='utf-8') as handle:
        layout = json.load(handle)
    scale = WIDTH / layout['width']
    depth = layout['height'] * scale
    checker = layout['pointWidth'] * scale * 0.92

    root = bpy.data.objects.new('backgammon', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('backgammon-plinth')

    board = kit.rounded_plate('backgammon-board', WIDTH, depth, THICKNESS, 0.012, corner_segments=8, location=(0.0, 0.0, TOP))
    kit.uv_box(board, scale=1.6)
    looks.board_uv(board, 'backgammon', WIDTH, depth)
    kit.assign(board, looks.board_face('backgammon'), looks.walnut())
    kit.slot(board, 1, lambda centre, normal: normal.z < 0.5)
    kit.smooth(board, 30.0)

    holder = bpy.data.objects.new('backgammon-checkers', None)
    bpy.context.collection.objects.link(holder)
    holder.parent = root
    placed = []
    for side, order in (('light', LIGHT), ('dark', DARK)):
        prototype = pieces.checker('backgammon-checker-' + side, side, diameter=checker, thickness=0.0078)
        for point, count in order.items():
            column = layout['columns'][point - 1]
            x = (column['x'] + layout['pointWidth'] / 2) * scale - WIDTH / 2
            top = column['row'] == 'top'
            edge = depth / 2 - layout['top' if top else 'bottom'] * scale
            step = -checker if top else checker
            for index in range(count):
                copy = prototype.copy()
                copy.name = 'backgammon-%s-%d-%d' % (side, point, index)
                bpy.context.collection.objects.link(copy)
                copy.location = (x, edge + (index + 0.5) * step, FIELD_TOP + 0.0005)
                copy.rotation_euler = (0.0, 0.0, (point * 7 + index * 13) % 360 * math.pi / 180)
                copy.parent = holder
                placed.append(copy)
        bpy.data.objects.remove(prototype, do_unlink=True)

    dice = []
    for index, (x, y, yaw, roll) in enumerate([(0.078, 0.007, 17.0, 0.0), (0.119, -0.012, -24.0, math.pi / 2)]):
        die = pieces.die('backgammon-die-%d' % index, 0.017, looks.ivory(), looks.ink())
        pieces.place(die, x, y, FIELD_TOP + 0.0085, math.radians(yaw), 0.0, roll)
        dice.append(die)
    settle.drop(dice[0], 'settle-backgammon-a', 0.2, (3.8, 1.5, 2.2), bounce=0.006, drift=(-0.03, 0.02))
    settle.drop(dice[1], 'settle-backgammon-b', 0.22, (-3.2, 2.4, -1.8), start=4, bounce=0.006, drift=(-0.02, -0.01))

    cube = pieces.doubling_cube('backgammon-cube', 0.024, 64)
    for part in cube:
        pieces.place(part, layout['bar'] * scale - WIDTH / 2, 0.0, FIELD_TOP + 0.012, math.radians(8.0))

    for obj in [plinth, board] + dice + cube:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [board],
        'raised': [],
        'pieces': placed + dice + cube,
        'surface_z': FIELD_TOP,
        'surface_size': WIDTH,
        'surface_clip': (WIDTH, depth),
        'hero': {'look_at': (0.0, 0.0, 0.15), 'position': (-0.3, -0.62, 0.5), 'fov': 30.0}
    }
