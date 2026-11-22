import {
    CanvasTexture,
    Mesh,
    MeshBasicMaterial,
    MeshStandardMaterial,
    Texture,
    type AnimationClip,
    type BufferGeometry,
    type Group,
    type Material,
    type Object3D
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { GAMES } from '../../data/games.ts';
import type { SceneSet } from '../quality/tiers.ts';

export interface Showcase
{
    root: Group;

    animations: AnimationClip[];

    textures: Texture[];

    frame(subjectX: number): void;

    dispose(): void;
}

function texturesOf(material: Material): Texture[]
{
    return Object.values(material).filter((value): value is Texture => value instanceof Texture);
}

/** A baked floor has a solid-colour rim. Fade its UV edges into the current studio sky. */
function floorMask()
{
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(64, 64, 31, 64, 64, 63);
    gradient.addColorStop(0, 'white');
    gradient.addColorStop(0.5, '#808080');
    gradient.addColorStop(1, 'black');
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    return new CanvasTexture(canvas);
}

function decal(material: Material, floor: Texture)
{
    const source = material as Material & { map?: Texture | null };
    const floorShadow = material.name.startsWith('decal-floor-');
    return new MeshBasicMaterial({
        name: material.name,
        map: source.map ?? null,
        alphaMap: floorShadow ? floor : null,
        opacity: floorShadow ? 0.46 : 1,
        transparent: true,
        depthWrite: false,
        toneMapped: false
    });
}

export async function loadShowcase(base: string, set: SceneSet, anisotropy: number): Promise<Showcase>
{
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${ base }/showcase-${ set }.glb`);
    const root = gltf.scene;

    const tables = GAMES.flatMap(game =>
    {
        const table = root.getObjectByName(game.id);
        if (table === undefined) return [];
        table.position.set(...game.anchor);
        return [table];
    });

    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const replaced = new Map<Material, MeshBasicMaterial>();
    const floor = floorMask();

    root.traverse((node: Object3D) =>
    {
        if (!(node instanceof Mesh))
        {
            return;
        }
        geometries.add(node.geometry);

        const own = (material: Material): Material =>
        {
            if (!material.name.startsWith('decal'))
            {
                // The varnished walnut catches the long studio window; felt and printed cards retain their authored finish.
                if (material instanceof MeshStandardMaterial && material.name === 'walnut') material.roughness = 0.56;
                materials.add(material);
                return material;
            }
            let swapped = replaced.get(material);
            if (swapped === undefined)
            {
                swapped = decal(material, floor);
                replaced.set(material, swapped);
                materials.add(swapped);
                material.dispose();
            }
            return swapped;
        };

        node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
    });

    root.updateMatrixWorld(true);
    root.traverse((node: Object3D) =>
    {
        node.matrixAutoUpdate = false;
    });

    const textures = [...new Set([floor, ...[...materials].flatMap(texturesOf)])];
    for (const texture of textures)
    {
        texture.anisotropy = anisotropy;
    }

    return {
        root,
        animations: gltf.animations,
        textures,

        frame(subjectX)
        {
            // Adjacent tables share the moving shot. Beyond it, ease each plinth out of the frame.
            for (const table of tables)
            {
                const distance = Math.abs(table.position.x - subjectX);
                const amount = Math.max(0, Math.min(1, (1.37 - distance) / 0.43));
                const scale = amount * amount * (3 - 2 * amount);
                if (table.scale.x === scale) continue;
                table.visible = scale > 0;
                table.scale.setScalar(scale);
                table.updateMatrix();
            }
        },

        dispose()
        {
            for (const geometry of geometries)
            {
                geometry.dispose();
            }
            for (const material of materials)
            {
                material.dispose();
            }
            for (const texture of textures)
            {
                texture.dispose();
            }
        }
    };
}
