import json
import os
from functools import cache

from lib import kit


def _art(name):
    return os.path.join(kit.ART, name)


def plinth():
    return kit.material('plinth', base='#101828', roughness=0.62, coat=0.12, coat_roughness=0.4)


def plinth_band():
    return kit.material('plinth-band', base='#0E1524', roughness=0.55)


def walnut():
    return kit.material(
        'walnut',
        base_image=kit.texture('dark_wood', 'Diffuse'),
        roughness_image=kit.texture('dark_wood', 'Rough'),
        normal_image=kit.texture('dark_wood', 'nor_gl'),
        normal_strength=0.6,
        coat=0.7,
        coat_roughness=0.12,
        uv_scale=2.2
    )


@cache
def _boards():
    with open(_art('boards.json'), encoding='utf-8') as handle:
        return json.load(handle)


def board_uv(obj, game, width, depth, only_up=True):
    atlas = _boards()
    tile = atlas['surfaces'][game]
    w = atlas['width']
    h = atlas['height']
    x, y, size = tile['x'], tile['y'], tile['size']
    rect = ((x + 0.5) / w, 1 - (y + size - 0.5) / h, (x + size - 0.5) / w, 1 - (y + 0.5) / h)
    kit.uv_planar(obj, rect, extent=((-width / 2, -depth / 2), (width / 2, depth / 2)), only_up=only_up)


def board_face(game):
    if game in ('hokm', 'poker'):
        return kit.material(game + '-baize', base_image=_art('boards.png'), roughness=0.86,
                            sheen=0.4, sheen_roughness=0.45, sheen_tint='#86C7AA')
    return kit.material('board-art', base_image=_art('boards.png'), roughness=0.48, coat=0.24, coat_roughness=0.18)


def leather():
    return kit.material('leather', base='#6E3926', roughness=0.6, coat=0.08, coat_roughness=0.35)


def brass():
    return kit.material('brass', base='#C9A15C', roughness=0.28, metallic=1.0)


def card():
    return kit.material('card', base_image=_art('cards.png'), roughness=0.38, coat=0.3, coat_roughness=0.14)


def chip():
    return kit.material('chip', base_image=_art('chips.png'), roughness=0.42, coat=0.18, coat_roughness=0.2)


def ink():
    return kit.material('ink', base='#101624', roughness=0.4)


def ivory():
    return kit.material('ivory', base='#F4EEDD', roughness=0.3, coat=0.6, coat_roughness=0.08)


def ebony():
    return kit.material('ebony', base='#1E1611', roughness=0.32, coat=0.75, coat_roughness=0.07)


def pawn(colour):
    enamel = {'red': '#AD4143', 'green': '#2D7356', 'blue': '#3F6795', 'yellow': '#C18C28'}
    return kit.material('pawn-' + colour, base=enamel[colour], roughness=0.32, coat=0.65, coat_roughness=0.1)


def checker(side):
    return kit.material('checker-' + side, base=kit.token('nard-' + side), roughness=0.3, coat=0.9, coat_roughness=0.05)


def checker_rim(side):
    return kit.material('checker-' + side + '-rim', base=kit.token('nard-' + side + '-rim'), roughness=0.34, coat=0.9, coat_roughness=0.05)
