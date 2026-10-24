// Compensation is awaited before reporting failure. This is not an atomic
// transaction or a lock; the local factory owns shared-storage serialization.
export async function runRecoverableMutation(
  apply: () => Promise<void>,
  rollback: () => Promise<void>,
  label: string,
): Promise<void> {
  try {
    await apply();
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      const detail = rollbackError instanceof Error
        ? rollbackError.message
        : String(rollbackError);
      throw new Error(`${label}に失敗し、ロールバックにも失敗しました: ${detail}`);
    }
    throw error;
  }
}
