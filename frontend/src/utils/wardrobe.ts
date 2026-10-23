
export const pretty = (value: string | null | undefined) => (value ? value.replace(/_/g, ' ') : '');
