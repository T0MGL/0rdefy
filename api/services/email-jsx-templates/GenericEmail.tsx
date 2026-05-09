import * as React from 'react';
import { BaseLayout } from './BaseLayout';
import {
  CTAButton,
  Divider,
  Heading,
  Paragraph,
  SmallText,
  SubHeading,
} from './components';
import { CURRENT_YEAR } from './brand';

export interface GenericEmailData {
  title: string;
  subtitle?: string;
  body: string;
  ctaText?: string;
  ctaUrl?: string;
  footerNote?: string;
  preheader?: string;
}

export function GenericEmail(data: GenericEmailData) {
  return (
    <BaseLayout preheader={data.preheader || data.subtitle || data.title}>
      <Heading>{data.title}</Heading>
      {data.subtitle ? <SubHeading>{data.subtitle}</SubHeading> : null}
      <Paragraph>{data.body}</Paragraph>
      {data.ctaText && data.ctaUrl ? (
        <CTAButton href={data.ctaUrl}>{data.ctaText}</CTAButton>
      ) : null}
      {data.footerNote ? (
        <>
          <Divider />
          <SmallText>{data.footerNote}</SmallText>
        </>
      ) : null}
    </BaseLayout>
  );
}

export function genericEmailSubject(data: GenericEmailData): string {
  return data.title;
}

export function genericEmailText(data: GenericEmailData): string {
  return [
    data.title,
    '',
    data.subtitle ? `${data.subtitle}\n` : '',
    data.body,
    '',
    data.ctaUrl ? `${data.ctaText}: ${data.ctaUrl}\n` : '',
    data.footerNote || '',
    '',
    `© ${CURRENT_YEAR} Ordefy`,
  ]
    .filter((line) => line !== '')
    .join('\n');
}
