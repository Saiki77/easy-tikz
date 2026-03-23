export class MathHelper {
    static parseDomain(domain: string): [number, number] {
        const [min, max] = domain.split(':').map(Number);
        return [min, max];
    }

    static parseTangentPoint(point: string, domain: [number, number]): number {
        const x = Number(point);
        if (isNaN(x)) {
            throw new Error('Invalid tangent point');
        }
        const [min, max] = domain;
        if (x < min || x > max) {
            throw new Error('Tangent point outside domain');
        }
        return x;
    }

    static calculateDerivative(expression: string, x: number): number {
        const h = 0.0001;
        const f = new Function('x', `return ${expression.replace(/\^/g, '**')}`);
        return (f(x + h) - f(x)) / h;
    }

    static findExtrema(expression: string, domain: string): { x: number; y: number; type: string }[] {
        const [min, max] = this.parseDomain(domain);
        const step = (max - min) / 100;
        const extrema: { x: number; y: number; type: string }[] = [];
        const f = new Function('x', `return ${expression.replace(/\^/g, '**')}`);
        const h = 0.0001;

        for (let x = min + step; x < max - step; x += step) {
            const deriv1 = this.calculateDerivative(expression, x - step);
            const deriv2 = this.calculateDerivative(expression, x);

            if ((deriv1 < 0 && deriv2 > 0) || (deriv1 > 0 && deriv2 < 0)) {
                const secondDeriv =
                    (this.calculateDerivative(expression, x + h) - this.calculateDerivative(expression, x)) / h;
                const type = secondDeriv > 0 ? 'minimum' : 'maximum';
                extrema.push({
                    x: Number(x.toFixed(3)),
                    y: Number(f(x).toFixed(3)),
                    type,
                });
            }
        }

        return extrema;
    }

    static calculateTangentLine(expression: string, x0: number): string {
        try {
            const f = new Function('x', `return ${expression.replace(/\^/g, '**')}`);
            const y0 = f(x0);
            const slope = this.calculateDerivative(expression, x0);
            return `${slope}*x + ${y0 - slope * x0}`;
        } catch (error) {
            console.error('Error calculating tangent line:', error);
            throw error;
        }
    }

    static evaluateExpression(expression: string, x: number): number {
        const f = new Function('x', `return ${expression.replace(/\^/g, '**')}`);
        return f(x);
    }
}
