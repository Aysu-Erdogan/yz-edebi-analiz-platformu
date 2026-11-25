import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScrollRegion } from './ScrollRegion';

// jsdom yerleşim hesaplamaz: kutunun ölçüleri elle verilir.
function size(scrollWidth: number, clientWidth: number) {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => clientWidth,
  });
}

afterEach(() => {
  // Ölçü sahtelerini kaldır (sonraki testler jsdom'un 0 değerlerini görsün).
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
});

const view = () =>
  render(
    <ScrollRegion label="Örnek tablo" className="mt-2">
      <table>
        <caption>Örnek</caption>
        <tbody>
          <tr>
            <td>x</td>
          </tr>
        </tbody>
      </table>
    </ScrollRegion>,
  );

describe('ScrollRegion', () => {
  it('içerik taşmıyorsa sıradan kutu: odak durağı ve bölge rolü yok', () => {
    size(300, 300);
    const { container } = view();
    const box = container.firstElementChild as HTMLElement;
    expect(box).toHaveClass('overflow-x-auto', 'mt-2');
    expect(box).not.toHaveAttribute('tabindex');
    expect(box).not.toHaveAttribute('role');
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('içerik taşıyorsa klavyeyle odaklanabilir, adlandırılmış bir bölge olur (WCAG 2.1.1)', () => {
    size(600, 300);
    view();
    const region = screen.getByRole('region', { name: 'Örnek tablo, kaydırılabilir tablo' });
    expect(region).toHaveAttribute('tabindex', '0');
    region.focus();
    expect(region).toHaveFocus();
  });

  it('1 pikselden küçük taşmayı (yuvarlama) taşma saymaz', () => {
    size(301, 300);
    const { container } = view();
    expect(container.firstElementChild).not.toHaveAttribute('tabindex');
  });

  it('pencere boyutu değişince yeniden ölçer: daralınca bölge olur, genişleyince olmaz', () => {
    size(300, 300);
    const { container } = view();
    const box = container.firstElementChild as HTMLElement;
    expect(box).not.toHaveAttribute('tabindex');

    size(600, 300);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(box).toHaveAttribute('tabindex', '0');
    expect(box).toHaveAttribute('role', 'region');

    size(300, 300);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(box).not.toHaveAttribute('tabindex');
    expect(box).not.toHaveAttribute('role');
  });

  it('içeriğini olduğu gibi gösterir', () => {
    size(300, 300);
    view();
    expect(screen.getByRole('table', { name: 'Örnek' })).toBeInTheDocument();
  });
});
