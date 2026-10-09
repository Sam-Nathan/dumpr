import { describe, expect, it } from 'vitest';
import {
  buildInviteLink,
  displayLink,
  linkSettingsSummary,
  shareMessage,
  smsUrl,
  whatsappUrl,
} from './links';

describe('invite links', () => {
  it('uses /r for roll invites and /c for crew invites', () => {
    expect(buildInviteLink('k7qm2xpa9d', 'roll-id')).toBe('https://dumpr.app/r/k7qm2xpa9d');
    expect(buildInviteLink('k7qm2xpa9d', null)).toBe('https://dumpr.app/c/k7qm2xpa9d');
    expect(buildInviteLink('k7qm2xpa9d', undefined)).toBe('https://dumpr.app/c/k7qm2xpa9d');
  });

  it('shows the link without the scheme', () => {
    expect(displayLink('https://dumpr.app/c/abc')).toBe('dumpr.app/c/abc');
  });

  it('builds share targets with the message encoded', () => {
    const msg = shareMessage("Goa '26", 'https://dumpr.app/r/abc', 'roll');
    expect(msg).toBe("Add your photos to Goa '26 on Dumpr: https://dumpr.app/r/abc");
    expect(whatsappUrl(msg)).toBe(`whatsapp://send?text=${encodeURIComponent(msg)}`);
    expect(smsUrl('hi there', 'ios')).toBe('sms:&body=hi%20there');
    expect(smsUrl('hi there', 'android')).toBe('sms:?body=hi%20there');
    expect(shareMessage('Goa Gang', 'u', 'crew')).toBe('Join Goa Gang on Dumpr: u');
  });

  it('summarises link settings', () => {
    expect(linkSettingsSummary({ ttlDays: 7, requiresApproval: true })).toBe(
      'Expires in 7 days · host approves new members',
    );
    expect(linkSettingsSummary({ ttlDays: 1, requiresApproval: false })).toBe('Expires in 1 day');
    expect(
      linkSettingsSummary({
        ttlDays: 30,
        requiresApproval: false,
        allowGuests: false,
        showGuests: true,
      }),
    ).toBe('Expires in 30 days · members only');
  });
});
