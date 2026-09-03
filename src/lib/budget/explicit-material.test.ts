import { describe, it, expect } from 'vitest';
import { parseExplicitMaterial, stripExplicitMaterialTag } from './explicit-material';

describe('parseExplicitMaterial', () => {
    it('extrae el material y limpia el texto', () => {
        const r = parseExplicitMaterial('Suministro y colocación de plato de ducha. [MATERIAL EXPLÍCITO: resina antideslizante]');
        expect(r.clean).toBe('Suministro y colocación de plato de ducha.');
        expect(r.material).toBe('resina antideslizante');
    });

    it('tolera la ausencia de tilde (EXPLICITO)', () => {
        const r = parseExplicitMaterial('Pladur [MATERIAL EXPLICITO: sin acento]');
        expect(r.clean).toBe('Pladur');
        expect(r.material).toBe('sin acento');
    });

    it('no toca texto sin marca', () => {
        const r = parseExplicitMaterial('Demolición de tabique');
        expect(r.clean).toBe('Demolición de tabique');
        expect(r.material).toBeNull();
    });

    it('colapsa dobles espacios que deja la marca en medio', () => {
        const r = parseExplicitMaterial('Alicatado [MATERIAL EXPLÍCITO: cerámica] con junta fina');
        expect(r.clean).toBe('Alicatado con junta fina');
        expect(r.material).toBe('cerámica');
    });

    it('maneja undefined/empty sin romper', () => {
        expect(parseExplicitMaterial(undefined).clean).toBe('');
        expect(parseExplicitMaterial(undefined).material).toBeNull();
        expect(stripExplicitMaterialTag('x [MATERIAL EXPLÍCITO: y]')).toBe('x');
    });
});
