// Zod schemas for /content front matter (content/README.md). Every object is .strict(), so a
// typo'd or unexpected key fails the build with the file and field. Shared with the server later.
import { z } from 'zod';

const text = z.string().trim().min(1);
const anchor = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'anchor must be lower-case kebab-case');
const httpsUrl = z.string().regex(/^https:\/\/[^\s"'<>]+$/, 'must be an https:// URL');
const localImage = z.string().regex(/^\/images\/[A-Za-z0-9._/-]+\.(?:jpe?g|png|webp|avif|svg)$/, 'must be a /images/… path');
const localMedia = z.string().regex(/^\/(?:images|video|cv)\/[A-Za-z0-9._/-]+$/, 'must be a /images, /video or /cv path');
const yearMonth = z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'must be YYYY-MM');
const list = z.array(text).min(1);

export const PROJECT_CATEGORIES = ['AI & RAG', 'Computer Vision', 'Full-Stack', 'Games & 3D', 'Motion & Video'];

export const profileSchema = z
  .object({
    anchor,
    name: text,
    short_name: text,
    title: text,
    headline: text,
    location: text,
    photo: localImage,
    photo_alt: text,
    links: z.object({ linkedin: httpsUrl, github: httpsUrl }).strict(),
    open_to: list,
    work_mode: list,
    languages: list,
  })
  .strict();

export const aboutSchema = z
  .object({
    anchor,
    title: text,
    stats: z
      .array(
        z
          .object({
            value: text.regex(/\d/, 'stat value needs a number'),
            label: text,
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

export const skillsSchema = z
  .object({
    anchor,
    title: text,
    categories: z.array(z.object({ name: text, items: list }).strict()).min(1),
  })
  .strict();

export const experienceSchema = z
  .object({
    anchor,
    title: text,
    roles: z
      .array(
        z
          .object({
            company: text,
            role: text,
            start: yearMonth,
            end: z.union([yearMonth, z.literal('present')]),
            location: text,
            summary: text,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const educationSchema = z
  .object({
    anchor,
    title: text,
    entries: z
      .array(
        z
          .object({
            institution: text,
            degree: text,
            specialization: text.optional(),
            start: yearMonth,
            end: z.union([yearMonth, z.literal('present'), z.string().regex(/^\d{4} \(expected\)$/)]),
            cgpa: z.string().regex(/^\d\.\d{1,2}$/, 'cgpa must be a quoted string like "3.65"').optional(),
            highlights: list.optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const achievementsSchema = z
  .object({
    anchor,
    title: text,
    items: z
      .array(
        z
          .object({
            title: text,
            event: text,
            date: z.union([text, z.number().int()]).optional(),
            detail: text.optional(),
            image: localImage.optional(),
            image_alt: text.optional(),
            type: z.enum(['award', 'certification']).optional(),
            anchor,
          })
          .strict()
          .refine((item) => !item.image || item.image_alt, { message: 'image needs image_alt', path: ['image_alt'] }),
      )
      .min(1),
  })
  .strict();

export const faqSchema = z.object({ anchor, title: text }).strict();

const linkValue = z.union([z.literal(''), httpsUrl, localMedia]);

export const projectSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: text,
    tagline: text,
    anchor,
    categories: z.array(z.enum(PROJECT_CATEGORIES)).min(1),
    stack: list,
    role: text,
    // content/README.md lists the base values; files may add a detail in brackets.
    context: z.string().regex(/^(?:Axisero \(work\)|University|Independent)(?: \([^()]+\))?$/, 'unknown context'),
    year: z.number().int().min(2000).max(2100),
    status: z.enum(['live', 'completed', 'in-development']),
    featured: z.boolean(),
    order: z.number().int(),
    links: z
      .object({ live: linkValue.optional(), repo: linkValue.optional(), video: linkValue.optional(), dashboard: linkValue.optional() })
      .strict(),
    images: z.array(localImage),
    highlights: z.array(text).min(1).max(4),
    draft: z.boolean().optional(),
  })
  .strict()
  .refine((p) => p.anchor === `project-${p.slug}`, { message: 'anchor must be project-<slug>', path: ['anchor'] });

/** Schema for each top-level content file, by file name. */
export const FILE_SCHEMAS = {
  'profile.md': profileSchema,
  'about.md': aboutSchema,
  'skills.md': skillsSchema,
  'experience.md': experienceSchema,
  'education.md': educationSchema,
  'achievements.md': achievementsSchema,
  'faq.md': faqSchema,
};
