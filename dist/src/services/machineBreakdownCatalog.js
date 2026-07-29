"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MACHINE_BREAKDOWN_CATALOG = void 0;
exports.isValidMachineComponent = isValidMachineComponent;
exports.MACHINE_BREAKDOWN_CATALOG = {
    'Edge Banding Machine - ZD700C': [
        'Glue pot / gluing unit',
        'End-cutting unit',
        'Fine-trimming unit',
        'Rough-trimming unit',
        'Corner-rounding unit',
        'Scraping unit',
        'Buffing roller',
        'Push wheel / feed wheel',
        'Drive belt',
        'Control button / switch',
        'Feed motor',
        'Other component',
    ],
    'Panel / Table Saw - ZDV8': [
        'Main saw blade',
        'Scoring blade',
        'Blade arbor / spindle',
        'Lifting mechanism',
        'Tilting mechanism',
        'Sliding table / carriage',
        'Fence / guide',
        'Drive belt',
        'Main motor',
        'Push wheel',
        'Control button / switch',
        'Other component',
    ],
    'Dust Collector - MF9030': [
        'Extractor motor',
        'Fan / impeller',
        'Filter bag',
        'Dust collection bag',
        'Pipe / duct',
        'Hose connection',
        'Control switch',
        'Other component',
    ],
    'Air Compressor 230L - 7.5KW': [
        'Compressor motor',
        'Pump / compressor head',
        'Drive belt',
        'Pressure switch',
        'Pressure gauge',
        'Air tank',
        'Safety / non-return valve',
        'Air hose / outlet',
        'Other component',
    ],
    'Blade Sharpener': [
        'Grinding wheel',
        'Sharpener motor',
        'Blade clamp / holder',
        'Feed / adjustment mechanism',
        'Grinding angle adjustment',
        'Coolant pump / line',
        'Control button / switch',
        'Other component',
    ],
};
function isValidMachineComponent(machine, component) {
    const components = exports.MACHINE_BREAKDOWN_CATALOG[machine];
    return Boolean(components?.includes(component));
}
