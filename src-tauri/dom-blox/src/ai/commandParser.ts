export interface ParsedCommand {
  intent: 'CREATE' | 'UPDATE' | 'DELETE' | 'UNKNOWN';
  target?: string;
  properties: {
    color?: string;
    material?: 'Plastic' | 'Neon' | 'Wood' | 'Metal';
    shape?: 'Box' | 'Sphere' | 'Cylinder';
    position?: [number, number, number];
    size?: [number, number, number];
  };
}

const COLORS: Record<string, string> = {
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  purple: '#800080',
  orange: '#ffa500',
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  pink: '#ffc0cb',
  cyan: '#00ffff',
};

const MATERIALS = ['Plastic', 'Neon', 'Wood', 'Metal'];
const SHAPES: Record<string, 'Box' | 'Sphere' | 'Cylinder'> = {
  box: 'Box',
  block: 'Box',
  cube: 'Box',
  sphere: 'Sphere',
  ball: 'Sphere',
  cylinder: 'Cylinder',
  column: 'Cylinder',
  tube: 'Cylinder',
  wall: 'Box',
  floor: 'Box',
  platform: 'Box',
};

export function parseCommand(input: string): ParsedCommand {
  const lower = input.toLowerCase();
  
  const cmd: ParsedCommand = {
    intent: 'UNKNOWN',
    properties: {}
  };

  // 1. Detect Intent
  if (lower.includes('create') || lower.includes('make') || lower.includes('add') || lower.includes('spawn')) {
    cmd.intent = 'CREATE';
  } else if (lower.includes('delete') || lower.includes('remove') || lower.includes('destroy')) {
    cmd.intent = 'DELETE';
  } else if (lower.includes('update') || lower.includes('change') || lower.includes('set') || lower.includes('move') || lower.includes('paint')) {
    cmd.intent = 'UPDATE';
  }

  // 2. Detect Shape / Target
  for (const [key, val] of Object.entries(SHAPES)) {
    if (lower.includes(key)) {
      cmd.properties.shape = val;
      cmd.target = key;
      break;
    }
  }

  // 3. Detect Color
  for (const [name, hex] of Object.entries(COLORS)) {
    if (lower.includes(name)) {
      cmd.properties.color = hex;
      break;
    }
  }

  // 4. Detect Material
  for (const mat of MATERIALS) {
    if (lower.includes(mat.toLowerCase())) {
      cmd.properties.material = mat as any;
      break;
    }
  }

  // 5. Detect Position (at x,y,z or x y z)
  const posMatch = lower.match(/at\s+(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
  if (posMatch) {
    cmd.properties.position = [parseFloat(posMatch[1]), parseFloat(posMatch[2]), parseFloat(posMatch[3])];
  }

  // 6. Detect Size (size x,y,z or x y z)
  const sizeMatch = lower.match(/size\s+(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)/);
  if (sizeMatch) {
    cmd.properties.size = [parseFloat(sizeMatch[1]), parseFloat(sizeMatch[2]), parseFloat(sizeMatch[3])];
  }
  
  // Special Handling for "Wall" / "Floor" presets
  if (cmd.target === 'wall' && !cmd.properties.size) {
      cmd.properties.size = [10, 8, 1];
      cmd.properties.shape = 'Box';
  }
  if (cmd.target === 'floor' && !cmd.properties.size) {
      cmd.properties.size = [20, 1, 20];
      cmd.properties.shape = 'Box';
  }

  return cmd;
}
