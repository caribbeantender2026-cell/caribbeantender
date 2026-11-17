/** Account pictures: own folder only, a daily limit, and shared with signed-in users through company_names. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { anonymous, createUser, runAs, user } from '../harness.ts';
import { assertNothingReachable, assertRefused, assertSucceeded, scalar, uploadAs, type FixSuite } from '../suite.ts';

const bucket = 'account-pictures';
const maximumDailyUploads = 20;
const oneMegabyte = 1_048_576;

/** A picture path the way the app names uploads. */
function picturePath(userId: string): string {
  return `${userId}/${randomUUID()}.webp`;
}

function setPictureAs(database: Parameters<typeof runAs>[0], userId: string, table: 'business_profiles' | 'supplier_profiles', path: string | null) {
  return runAs(database, user(userId), `update public.${table} set picture_path = $2 where user_id = $1 returning user_id`, [userId, path]);
}

export const accountPicturesSuite: FixSuite = {
  migration: '20261117010000_account_pictures.sql',
  title: 'Account pictures: own folder only, limited per day, visible to signed-in users',
  cases: [
    {
      name: 'The bucket is public and takes only WebP or PNG pictures up to 1 MB',
      run: async (database) => {
        const settings = await database.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
          `select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1`,
          [bucket],
        );
        const [settingsRow] = settings.rows;
        assert.ok(settingsRow, 'the account-pictures bucket should exist');
        assert.equal(settingsRow.public, true);
        assert.equal(Number(settingsRow.file_size_limit), oneMegabyte);
        assert.deepEqual(settingsRow.allowed_mime_types, ['image/webp', 'image/png']);
      },
    },
    {
      name: "A person uploads only into their own folder, never into someone else's or a subfolder",
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherId = await createUser(database, { accountType: 'supplier' });
        assertSucceeded(await uploadAs(database, ownerId, bucket, picturePath(ownerId)), 'upload into own folder');
        assertRefused(await uploadAs(database, otherId, bucket, picturePath(ownerId)), "upload into someone else's folder");
        assertRefused(await uploadAs(database, ownerId, bucket, `${ownerId}/nested/${randomUUID()}.webp`), 'upload into a subfolder');
        assertRefused(await uploadAs(database, ownerId, bucket, `${randomUUID()}.webp`), 'upload outside any folder');
      },
    },
    {
      name: 'At most 20 picture uploads a day, and only the owner can remove theirs',
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherId = await createUser(database, { accountType: 'business' });
        const firstPath = picturePath(ownerId);
        assertSucceeded(await uploadAs(database, ownerId, bucket, firstPath), 'first upload');
        assertNothingReachable(
          await runAs(database, user(otherId), `delete from storage.objects where bucket_id = $1 and name = $2 returning id`, [bucket, firstPath]),
          "remove someone else's picture",
        );
        assert.equal(
          (await runAs(database, user(ownerId), `delete from storage.objects where bucket_id = $1 and name = $2 returning id`, [bucket, firstPath])).rows.length,
          1,
          'the owner removes their own picture',
        );
        const count = await runAs<{ used: number }>(database, user(ownerId), 'select private.uploads_in_last_day($1) as used', [bucket]);
        for (let used = assertSucceeded(count, 'get the rolling quota')[0]!.used; used < maximumDailyUploads; used++) {
          assertSucceeded(await uploadAs(database, ownerId, bucket, picturePath(ownerId)), 'upload within quota');
        }
        assertRefused(await uploadAs(database, ownerId, bucket, picturePath(ownerId)), 'upload number 21 in a day');
      },
    },
    {
      name: "A profile can point only at a picture in its owner's folder",
      run: async (database) => {
        const ownerId = await createUser(database, { accountType: 'business' });
        const otherId = await createUser(database, { accountType: 'business' });
        assert.equal(assertSucceeded(await setPictureAs(database, ownerId, 'business_profiles', picturePath(ownerId)), 'set own picture').length, 1);
        assertRefused(await setPictureAs(database, ownerId, 'business_profiles', picturePath(otherId)), "point at someone else's picture");
        assertRefused(await setPictureAs(database, ownerId, 'business_profiles', `${ownerId}/../${otherId}/picture.webp`), 'point outside the folder');
        assertRefused(await setPictureAs(database, ownerId, 'business_profiles', `${ownerId}/${randomUUID()}.svg`), 'point at a non-picture file');
        assertNothingReachable(
          await runAs(database, user(otherId), `update public.business_profiles set picture_path = null where user_id = $1 returning user_id`, [ownerId]),
          "clear someone else's picture",
        );
      },
    },
    {
      name: 'Signed-in users see each account picture next to its company name; visitors see none',
      run: async (database) => {
        const businessId = await createUser(database, { accountType: 'business' });
        const supplierId = await createUser(database, { accountType: 'supplier' });
        const businessPicture = picturePath(businessId);
        const supplierPicture = picturePath(supplierId);
        assertSucceeded(await setPictureAs(database, businessId, 'business_profiles', businessPicture), 'business sets its picture');
        assertSucceeded(await setPictureAs(database, supplierId, 'supplier_profiles', supplierPicture), 'supplier sets its picture');
        const seenBySupplier = await runAs<{ picture_path: string }>(
          database,
          user(supplierId),
          `select picture_path from public.company_names where user_id = $1 and account_type = 'business'`,
          [businessId],
        );
        assert.deepEqual(seenBySupplier.rows, [{ picture_path: businessPicture }]);
        assert.equal(
          await scalar<string>(database, `select picture_path as value from public.company_names where user_id = $1 and account_type = 'supplier'`, [supplierId]),
          supplierPicture,
        );
        assertSucceeded(await setPictureAs(database, businessId, 'business_profiles', null), 'business removes its picture');
        assert.equal(
          await scalar<string | null>(database, `select picture_path as value from public.company_names where user_id = $1 and account_type = 'business'`, [businessId]),
          null,
        );
        assertNothingReachable(await runAs(database, anonymous, `select picture_path from public.company_names`), 'visitors read pictures');
      },
    },
  ],
};
