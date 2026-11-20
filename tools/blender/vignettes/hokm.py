import math

import bpy

from lib import kit
from lib import looks
from lib import pieces
from lib import studio

TOP = studio.PLINTH_HEIGHT
SLAB = 0.44
SLAB_HEIGHT = 0.026
CLOTH_TOP = TOP + SLAB_HEIGHT

HAND = ['KS', 'AS', '10H', 'JH', 'QH', 'KH', 'AH']
TRICK = [('KD', 0.0, 0.052, 6.0), ('10D', 0.046, 0.018, 97.0), ('7D', -0.046, 0.02, -84.0), ('AD', 0.004, -0.012, 176.0)]


def build():
    root = bpy.data.objects.new('hokm', None)
    bpy.context.collection.objects.link(root)

    plinth = studio.plinth('hokm-plinth')

    slab = kit.rounded_plate('hokm-slab', SLAB, SLAB, SLAB_HEIGHT, 0.03, corner_segments=8, location=(0.0, 0.0, TOP))
    kit.uv_box(slab, scale=1.6)
    looks.board_uv(slab, 'hokm', SLAB, SLAB)
    kit.assign(slab, looks.board_face('hokm'), looks.walnut())
    kit.slot(slab, 1, lambda centre, normal: normal.z < 0.5)
    kit.smooth(slab, 30.0)

    hand = [pieces.card('hokm-hand-%d' % index, code) for index, code in enumerate(HAND)]
    pieces.fan(hand, 0.0, -0.118, CLOTH_TOP + 0.0004, math.pi / 2, spread=11.0, pivot=0.09)

    trick = []
    for index, (code, x, y, yaw) in enumerate(TRICK):
        placed = pieces.card('hokm-trick-%d' % index, code)
        pieces.place(placed, x, y + 0.035, CLOTH_TOP + 0.0004 + index * 0.0005, math.radians(yaw))
        trick.append(placed)

    won = []
    for index in range(4):
        placed = pieces.card('hokm-won-%d' % index, 'KH', face_up=False)
        pieces.place(placed, 0.125 + index * 0.0016, 0.115 - index * 0.0012, CLOTH_TOP + 0.0004 + index * 0.0005, math.radians(-14.0 + index * 3.5))
        won.append(placed)

    cards = hand + trick + won
    for obj in [plinth, slab] + cards:
        obj.parent = root

    return {
        'root': root,
        'plinth': plinth,
        'surfaces': [slab],
        'raised': [],
        'pieces': cards,
        'surface_z': CLOTH_TOP,
        'surface_size': SLAB,
        'hero': {'look_at': (0.0, -0.01, 0.15), 'position': (-0.34, -0.62, 0.5), 'fov': 30.0}
    }
