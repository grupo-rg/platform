import { ProjectSpecs } from './project-specs';

export class BudgetNarrativeBuilder {
    static build(specs: ProjectSpecs): string {
        const lines: string[] = [];

        if ((specs as any).originalRequest) {
            lines.push(`Petición Original del Cliente:\n"${(specs as any).originalRequest}"\n`);
        }


        lines.push(`Proyecto de tipo: ${specs.interventionType === 'new_build' ? 'Obra Nueva' : specs.interventionType === 'total' ? 'Reforma Integral' : 'Reforma Parcial'}`);
        lines.push(`Superficie total: ${specs.totalArea} m²`);
        lines.push(`Calidad deseada: ${specs.qualityLevel}`);

        if (specs.rooms?.length) {
            lines.push(`\nHabitaciones (${specs.rooms.length}):`);
            specs.rooms.forEach((room, i) => {
                lines.push(`- Habitación ${i + 1}: ${room.area} m²`);
            });
        }

        if (specs.bathrooms?.length) {
            lines.push(`\nBaños (${specs.bathrooms.length}):`);
            specs.bathrooms.forEach((bath, i) => {
                lines.push(`- Baño ${i + 1}: ${bath.area} m² (${bath.quality})`);
            });
        }

        if (specs.kitchens?.length) {
            lines.push(`\nCocinas (${specs.kitchens.length}):`);
            specs.kitchens.forEach((kitchen, i) => {
                lines.push(`- Cocina ${i + 1}: ${kitchen.area} m² (${kitchen.quality})`);
            });
        }

        if (specs.demolition) lines.push('- Incluye demolición previa');
        if (specs.elevator) lines.push('- Requiere instalación de ascensor');
        if (specs.parking) lines.push('- Incluye plaza de parking');

        return lines.join('\n');
    }
}
